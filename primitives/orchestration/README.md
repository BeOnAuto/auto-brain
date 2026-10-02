# @beonauto/orchestration

The orchestration primitive of auto-brain: deterministic steps that run the other primitives of a brain. A workflow is a spec like any other, created, versioned and executed through the spec operations of [`@beonauto/specs`](../../packages/specs), and run durably on [Temporal](https://temporal.io) by one generic interpreter workflow.

## A workflow spec

A spec document of orchestration is a YAML workflow in the [Open Workflow Specification](https://github.com/open-workflow-specification/specification) DSL 1.0.x (the CNCF Serverless Workflow DSL), media type `application/yaml`. It has:

- `document`: `dsl` (`1.0.0` to `1.0.3`), `namespace`, `name`, `version`, and an optional `title` and `summary`. The `summary`, or else the `title`, is the description of the spec.
- `input`: an optional `from` that shapes the input, and an optional inline JSON Schema `document`, published as the `input_schema` of the spec.
- `do`: the named tasks, run in order.
- `output`: an optional `as` that shapes the output, and an optional inline JSON Schema, published as the `output_schema`.
- an optional `timeout`, and optional `use.errors`, `use.retries` and `use.timeouts` that tasks reuse by name.

This workflow classifies a support ticket with an inference spec, branches on the answer, and retries paging someone until it gives up:

```yaml
document:
  dsl: '1.0.3'
  namespace: acme
  name: triage-ticket
  version: '1.0.0'
  title: Triage a support ticket
  summary: Classifies a ticket with an inference spec, then escalates urgent ones and files the rest.
input:
  schema:
    document:
      type: object
      properties:
        ticket: { type: string }
      required: [ticket]
use:
  retries:
    patient:
      delay: { seconds: 2 }
      backoff: { exponential: {} }
      limit:
        attempt: { count: 3 }
do:
  - classify:
      call: execute_spec
      with:
        primitive: inference
        name: classify-ticket
        input:
          ticket: ${ .ticket }
      output:
        as: '${ $input + { category: .category, urgent: .urgent } }'
  - route:
      switch:
        - urgent:
            when: .urgent == true
            then: escalate
        - routine:
            then: file
  - escalate:
      try:
        - page:
            call: execute_spec
            with:
              primitive: interaction
              name: page-on-call
              input:
                summary: '${ "Urgent " + .category + " ticket: " + .ticket }'
      catch:
        errors:
          with: { status: 503 }
        retry: patient
        do:
          - giveUp:
              raise:
                error:
                  type: https://example.com/errors/on-call-unreachable
                  status: 503
                  title: Nobody on call could be paged
      then: end
  - file:
      set:
        filed: true
        category: ${ .category }
```

## What a workflow may do

| Allowed                                                                       | Rejected in this version                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `set`, `do`, `switch`, `for` (with `while`), `fork` (with `compete`)          | `run` (shell, script, container, workflow) and `emit`                                                    |
| `call: execute_spec`                                                          | `call` of `http`, `grpc`, `openapi`, `asyncapi`, `a2a`, `mcp`, or of any other function                  |
| `try` with `catch` (`errors.with`, `as`, `when`, `exceptWhen`, `retry`, `do`) | `use.catalogs`, `use.extensions`, `use.functions`, `use.secrets`, `use.authentications`, and `schedule`  |
| `raise`, `wait`, `listen` (`one`, `all`, `any`; `read`)                       | `listen` with `until`, `foreach` or `correlate`; schemas on tasks; schemas not inline or not JSON Schema |
| `then: continue`, `exit`, `end`, or the name of a task in the same list       | executing an orchestration spec from a workflow                                                          |
| `if`, `input.from`, `output.as`, `export.as`, `timeout`                       | the jq builtins `localtime` and `strflocaltime`; durations in years or months                            |

A document may nest task lists (`do`, `for`, `try`, `catch.do`, `fork.branches`) at most 64 levels deep and any value at most 512 levels; a deeper document is rejected at the list or value that is too deep, before anything else is checked, and a workflow refuses to start with one however it was stored.

A fork may have at most 32 branches, checked when the document is stored and again when a workflow starts. A workflow may run for at most `ORCHESTRATION_MAX_DURATION` (30 days unless set otherwise): a `wait` or a `timeout` written as a duration longer than that is rejected when the document is stored, and one an expression computes longer fails the task that computes it with a `configuration` error.

Creating or updating a spec checks its document fully: it reads the YAML without aliases, anchors or tags, validates it against the DSL schema and its rules, builds its graph of tasks, and applies the policy above. Every problem is an issue under `/source` with the line, the column and the JSON Pointer of the place: `Line 8, column 12: at /do/0/loop/for: It needs in`. When a workflow starts, the interpreter applies again only the policy's prohibitions, what this runtime does not allow at all: the tasks, calls, components, `schedule` and `listen` options of the rejected column above, executing another workflow, schemas that are not inline JSON Schema, and a DSL version other than 1.0.x. So a document that never went through the spec operations cannot use what the policy forbids. The other problems the spec operations reject, such as an expression that does not parse or uses `localtime`, a duration in years, or a `then` that names no task, are not checked again: they fail the task that has them when it runs.

### Expressions

Expressions are [jq](https://jqlang.org), evaluated by `@gabrielbryk/jq-ts` inside the workflow. A string enclosed in `${ }` is an expression wherever the DSL takes a value; `if`, `when`, `exceptWhen`, `for.in`, `while`, and the strings of `input.from`, `output.as` and `export.as` are expressions even without `${ }`. They see `.` (the data of the step), `$context` (what tasks exported), `$input`, `$output` (in `export.as`), `$task` (`name`, `reference`, `definition`, `input`, `startedAt`, and `output` after the task ran), `$workflow` (`id`, the execution id; `definition`; `input`; `startedAt`), `$runtime` (`name: auto-brain`), and the variables of loops (`$item` and `$index` unless named with `each` and `at`) and catches (`$error` unless named with `as`). `now` is the time of the workflow, recorded in its history, never the clock of the host.

### The work of expressions

Workflows of every org share the threads of the worker, so no document may make one of them busy for long. Every operation of jq that builds or visits values charges, before it does so, the work of what it builds or visits, in units of one string character: a value, array item or object entry counts 16, copying an object entry 32, an evaluation step 128, a character encoded with a format or changed in case 16, a character searched for or in 4, a thread of the regex machine at a position 8. The count is deterministic, so it decides the same way when a history is replayed; no clock is read.

- An expression may do 8000000 units. One that tries to do more stops at once, and the task fails with a `runtime` error of status 500; jq's `try` cannot catch it, and the workflow's `try` can.
- Pure tasks run one after another without waiting. Before a task, a workflow that has done 8000000 units of expression work, or run 100 tasks, since its activation began lets other workflows run: it waits on a 1 ms timer, which ends the activation. A task cannot pause in the middle, so a workflow fails with a `runtime` error once it has done 16000000 units in one activation.
- A value the workflow holds, its input, the output of a task, its context and its output, may take at most 8000000 units to visit and nest at most 512 levels deep; a value counts a part it shares as often as it holds it, so doubling a value from task to task fails too. An execution with an input deeper than that is rejected with `invalid_input` before the workflow starts.

Measured on an Apple M-series machine, the expressions that do the most work per unit, run up to the budget, take at most about 30 ms and allocate at most about 25 MB (`@base64` of a 400000-character string); before the budget, `"x" * 40000000 | length` took 0.5 s and 0.8 GB, and `"a" * 200000 | indices("a" * 100000)` 2.5 s.

The count comes from a patch of `@gabrielbryk/jq-ts` 1.7.0 (`patches/@gabrielbryk__jq-ts@1.7.0.patch` at the root of the repository), which the library offers no hook for. It adds the `maxWork` limit and the `usage` it reports, charges the operations listed above, and replaces the library's string search, which in the engine's worst case takes time in proportion to the product of the two lengths, with the Knuth-Morris-Pratt search, linear in their sum. A new version of the library needs the patch ported, and `src/dsl/expression-work.test.ts` fails for any charge that goes missing.

### Executing a spec

`call: execute_spec` with `with: { primitive, name, input }` executes the active spec of that primitive and name in the same brain, for the caller who started the workflow, and outputs its output. The input is `{}` when left out and may take at most 262144 bytes as JSON. A rejection or a failure is an error the workflow can catch:

| The execution            | Error type (under `https://open-workflow-specification.org/spec/1.0.0/errors/`) | Status |
| ------------------------ | ------------------------------------------------------------------------------- | ------ |
| rejected `invalid_input` | `validation`                                                                    | 400    |
| rejected `forbidden`     | `authorization`                                                                 | 403    |
| rejected `not_found`     | `configuration`                                                                 | 404    |
| rejected `conflict`      | `runtime`                                                                       | 409    |
| rejected `unavailable`   | `communication`                                                                 | 503    |
| failed                   | `runtime`                                                                       | 500    |
| could not be reached     | `communication`                                                                 | 503    |

The `title` names the spec and the reason, and the `detail` carries the detail of the rejection with its issues. Retrying is the document's choice, with `try` and `catch.retry`: the interpreter waits on durable timers between attempts. Temporal itself retries only transient failures of the activity, up to 5 times.

Each run of a call is its own execution, with an id derived from the workflow run, the reference of the task and how many times that task ran: a UUID version 5. When Temporal retries the activity of a call, the call asks for the same execution id, so an execution that already has a final result is answered from the ledger and its model is not called again.

The activity of a call heartbeats every 10 seconds while the nested execution runs, with a heartbeat timeout of 30 seconds, and may run for the longest a nested execution may legitimately take and a minute more: the most `longestExecutionMs` the server's primitives state (see `@beonauto/specs`), which the client puts in the run. For inference that is the deadline of a model call for the most output tokens, 60 seconds and 25 ms a token, 1660 seconds for 64000, so 1720 seconds; a primitive that states none is given 10 minutes. When the server running a nested execution dies, Temporal sees no heartbeat for 30 seconds, fails that attempt and retries it a second later on a worker of the task queue, where the nested execution runs again under the same id, since one that started and never finished runs again for its id: a call recovers about 31 seconds after its server died, once a worker polls the task queue. A nested execution that hangs while it heartbeats is ended by the start-to-close timeout, and retried the same way.

### Events

A `listen` task waits for events sent to the running execution with `send_execution_event`, an operation of this package:

| Operation              | Kind    | Route                                    | Input                                                                                               | Answer                                              | Rejections                 |
| ---------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| `send_execution_event` | command | `POST /executions/{execution_id}/events` | `execution_id`, `event` (`type`, and optional `source`, `subject`, `data` of at most 256 KiB, `id`) | `{ execution_id, event }`, with its `id` and `time` | `not_found`, `unavailable` |

An event waits in the workflow until a `listen` task takes it; an event with an id the workflow already received is ignored, so a call can be retried with the same id. A filter matches an event when every attribute it names equals the attribute of the event, or, for an attribute written as an expression, when the expression holds on it. `read: data` (the default) outputs the `data` of the events, `envelope` and `raw` the whole events.

## Execution and settling

`execute_spec` of a workflow spec starts the workflow `runWorkflowSpec` on Temporal and answers the execution `started`. The workflow id is `{org}/{brain}/{spec}/{execution id}`, and a start with an id already running answers that run, so an execution started twice runs one workflow. The execution records `{ workflow_id, run_id }`. When Temporal cannot be reached within 10 seconds, the execution is rejected with `unavailable` and the fixed detail `Temporal cannot start the workflow now; try again later`; an event Temporal cannot take answers `unavailable` with `Temporal cannot deliver the event now; try again later`. Temporal's own error goes only to the server's log, as the warning `Temporal could not start a workflow` (or `deliver an event`) with the error cut at 500 characters, at most once a minute for each client, the next line counting the failures it did not log in `suppressed`.

When the workflow ends, a last local activity settles the execution through `executionSettler` of `@beonauto/specs`:

- **succeeded** with the output of the workflow, when it completes;
- **rejected** when an error is not caught: `invalid_input` for an error of a 4xx status other than 408 and 429 (the input led to it, and retrying the execution answers the same), and `unavailable` for every other status (a timeout, a failure to reach a spec, a server error: retrying the execution may succeed). The detail is the title or type, the detail and the instance of the error;
- **failed** when the workflow is cancelled, when it breaks down, or when its output is larger than an execution records (1048574 bytes as JSON).

Settling is a local activity, so it happens once per execution however the worker fails: Temporal retries it, and settling again with the same result records nothing. A local activity runs in the worker that runs the workflow's task, with slots of its own, so settling never waits behind nested executions, which are ordinary activities and may take every activity slot for half an hour; a second task queue for settling would need a second worker in the process for one short ledger write. A conflict, such as a workflow that ends before its execution recorded that it finishes later, is retried for 20 attempts, from 1 second apart doubling up to 1 minute, about 14 minutes in all; every retry after the first waits on a timer of the workflow, so a workflow waiting to settle again holds no workflow task. A workflow that fails or is cancelled ends failed or cancelled in Temporal too, after settling.

When settling fails for good, because the ledger has no such execution, because the run may not settle it, or because its last attempt failed, the workflow fails in Temporal and the execution stays `started` in the ledger. The activity tells the `reportUnsettled` the worker was given, with the org, the brain, the execution id and the reason, never the input or output, so an operator sees an error in the log of the server and a failed workflow in Temporal under the same id. Reconciling such an execution is manual in this version. A last attempt that times out instead of failing is not reported; it shows only in Temporal.

Each workflow starts with an execution timeout of `ORCHESTRATION_MAX_DURATION`. Temporal ends a workflow that reaches it without running any more of its code, so nothing could settle its execution then. Instead, the workflow sets its own deadline an hour earlier, a durable timer it starts with its first task: when that fires it cancels what is running, settles its execution failed, and fails in Temporal with the type `WorkflowRanTooLong` and a message saying how long it ran, which is the reason an operator reads, since a failed execution carries none in the ledger. Only if no worker runs the workflow at all during that last hour does Temporal's timeout end it unsettled; the execution then stays `started`, nothing is reported, and Temporal shows the workflow timed out.

Limits keep a workflow inside what Temporal holds: a call rejects an input larger than an execution takes, an activity fails an output larger than 1 MiB, and a workflow stops with a `runtime` error before its history passes 8 MiB or 40000 events, or once it has run 10000 tasks without waiting for anything (the timers that let other workflows run do not count as waiting). [The work of expressions](#the-work-of-expressions) has its own limits.

### Determinism and replay

The interpreter runs in Temporal's workflow sandbox and must make the same decisions when a history is replayed. The entry module removes Node's `Temporal` global, whose clock reads real time; expressions get the time of the workflow; `localtime` and `strflocaltime`, which read the time zone of the host, are rejected; jitter draws from the deterministic random of the workflow.

`histories/` holds histories recorded from the integration tests, one for each path of the interpreter that issues commands: a call of `execute_spec` and a `set` (`execute-spec`), a `try` retried with backoff on timers (`retry-with-backoff`), a caught error that recovers through `catch.do` (`catch-do-recovery`), a `raise` nobody catches (`uncaught-error`), a `wait` (`timer`), a `for` loop that waits (`for-with-wait`), a fork (`parallel-fork`) and a fork that competes, cancelling the slower branch (`fork-compete`), a `listen` that takes events sent while it waits (`listen-signals`), a `timeout` that fires and is caught (`timeout-fires`), a `switch` (`switch`), a `then` that jumps back to an earlier task (`then-jump-back`), a cancelled workflow (`cancelled`), a worker killed while it runs one (`worker-restart`), and the probe of Node's `Temporal` global (`temporal-global`); every one also starts and cancels the deadline timer. `src/workflow/replay.test.ts` replays every one against the interpreter, so a change that alters the commands a workflow issues fails a test. To record them again, deliberately, run `RECORD_HISTORIES=1 pnpm --filter @beonauto/orchestration test` and then `pnpm format`. A change to what the interpreter issues must keep old histories replaying: guard it with Temporal's patching (`patched`), keep the old histories, and add new ones.

## Running it

The server serves workflows when `TEMPORAL_ADDRESS` is set (`packages/server/src/workflows.ts`); without it, it loads no Temporal code and offers only the other primitives. The pieces it puts together:

- `readTemporalSettings(environment)`, from the entry `@beonauto/orchestration/settings`, which imports nothing of Temporal: none when `TEMPORAL_ADDRESS` is unset, the settings below otherwise, and `temporal_settings_invalid` naming every setting that is wrong and what it expects, never its value.
- `connectOrchestration(settings)` (scoped): the Temporal client that starts workflows and signals events. Each request answers within its deadline, 10 seconds, even while Temporal's client still retries it, and closing the client waits for those retries to end, because a retry that runs after its connection closed throws from a timer and ends the process.
- `makeOrchestration({ client })`, the primitive for `makeSpecOperations`, and `defineSendExecutionEvent(client)`, the brain operation `send_execution_event`.
- `installTemporalRuntime(log)`: Temporal's runtime with no shutdown signals and a logger that hands the server only what an operator acts on, as [the server's log](#what-the-server-logs-from-temporal) describes.
- `runOrchestrationWorker({ settings, executeSpec, settle, reportUnsettled, onFailure, workflowBundle })` (scoped): the worker, inside the server process. `executeSpec` runs a nested execution through the server's dispatcher, as the caller captured when the workflow started (`specExecutionResultOf` turns its outcome into a result), and `settle` is `executionSettler` over the server's ledger.

The worker connects to Temporal, runs, and shuts down when its scope closes: activities in flight get 10 seconds to finish, and are then left to Temporal's retries, and then its connection closes. It fails with `OrchestrationWorkerError` when Temporal cannot be reached or the worker cannot be made, closing the connection it opened. The server starts it again after such a failure, and after a worker that stops on its own, with a delay that doubles from 1 second up to 30 seconds.

The server owns the process's signals. Temporal's runtime is installed once, by `installTemporalRuntime` or else by the worker, with no `shutdownSignals`, so a `SIGTERM` does not stop the worker behind the server's back. A runtime that something else installed or instantiated first makes the worker fail to start with Temporal's `IllegalStateError`. When Temporal shuts an idle runtime down, it creates it again with the options it was installed with. Stopping a worker that already stopped is harmless.

### What the server logs from Temporal

Temporal's warnings and errors, the native core's included, reach the server's log only when an operator has something to do:

- the worker cannot reach Temporal (`gRPC call poll_workflow_task_queue retried 6 times`, with `errorCode` such as `Unavailable`);
- a workflow task fails, which only a fault of the runtime causes: an error outside the interpreter, or a nondeterminism error, which carries `failureCode: TMPRL1100`;
- an activity fails: settling or a nested execution broke down, or a run acted for another brain (`errorType: TenancyViolation`);
- a workflow ends for a fault of the runtime: `The workflow failed for a fault of the runtime`, with `failureType` `WorkflowBrokeDown` or `InvalidRun`.

A workflow that fails for a reason of its tenant, an uncaught error, a rejected nested execution, a cancellation or a limit, is not logged at all; its execution's rejection says why, and Temporal's history keeps the rest. A forwarded line carries Temporal's message up to its first colon and only fixed fields: the namespace, task queue, workflow type, workflow id and run id, the activity type and attempt, the type or code of the error and the code of a failure. It never carries an error's message, a stack trace, a payload, a header, or an activity id, which names a task of the document. Every forwarded text is cut at 500 characters.

A worker that stops on its own, because its run fails (Temporal unreachable for good, a fatal worker error) or ends without being asked to, calls `onFailure` once with a detail saying why; stopping it when its scope closes calls nothing. While the worker is down, executing a workflow spec still answers `started` whenever Temporal accepts the start, and `unavailable` only when it does not; the workflow waits on its task queue until a worker polls it again.

### Memory

What a server spends on workflows is bounded by limits a tenant cannot raise, so that no caller can push the process past a size an operator can plan for. The limits, and how they add up with the defaults:

- **Data a workflow holds at once**, at most 16 MiB. The interpreter counts, while each task runs, its input and 4 KiB for the task itself, and also the collection a `for` walks, the outputs of a fork's finished branches until the fork ends, a caught error during `catch.do`, the exported context, and the workflow's input and document; a value held by several tasks counts once. A value counts by an estimate of its bytes, two per character, 16 per number and 128 to 160 per array or object; against the heap V8 used for values of each shape built with `fromjson` and string repetition (flat one- and two-byte strings, numbers, short strings, empty and one- and two-key objects, empty arrays, pairs, nulls, nested arrays), the estimate was 1.0 to 4.8 times the heap. A task that would hold more fails with a `runtime` error.
- **Events** (`send_execution_event`): each at most 256 KiB as JSON, its `type` and `id` at most 256 characters and its `source` and `subject` at most 1024. A workflow holds at most 64 events it has not consumed, and 1 MiB of them by the same estimate; it takes at most 1024 events, or 4 MiB of them as JSON, over its life, counting events it ignores as repeated. One more fails the workflow with a `runtime` error at once, whatever it is doing; its execution settles `rejected`, and later events are rejected as `not_found`.
- **A workflow held in the worker's cache** therefore takes at most about 18 MiB: the 16 MiB above, 1 MiB of events, the ids of up to 1024 events, and about 0.45 MiB of its own (300 idle cached workflows grew the process by 132 MiB). The worker caches at most 16 workflows, about 290 MiB in all.
- **Replaying a history**, which the worker does when a workflow that is not cached has something to do, grew the process by about 7.5 times the history's bytes (66 MiB for a history of 8.8 MiB, 189 MiB for 26.4 MiB, with the bundle built ahead). The worker runs at most 2 workflow tasks at once. A workflow stops before its history passes 8 MiB, checked before each task that waits or calls a spec; tasks already running when it was checked can add their outputs (each nested output at most 1 MiB) and events can still arrive, up to the limits above, so a history ends a little past 8 MiB, about 60 to 75 MiB to replay. Temporal itself ends a workflow whose history reaches its limit, 50 MiB by default (`limit.historySize.error`): replaying one of those takes up to about 375 MiB.
- **The server itself**, with workflows offered and the bundle built ahead, takes about 390 MiB idle.

With the defaults, workflows can make the process hold at most about 390 + 290 + 2 x 75 = 830 MiB in the expected worst case, and 390 + 290 + 2 x 375 = 1430 MiB if two workflows near Temporal's own history limit replay at once. Requests to the API add what they carry (each body at most 1 MiB), and nested executions add what their primitives use, at most `ORCHESTRATION_NESTED_EXECUTIONS` (32) of them at once. An operator who wants the second figure lower sets Temporal's history limit for the namespace lower.

### The workflow bundle

A worker given only the workflow code bundles it with webpack and swc when it starts, as in development and the tests; swc's native code comes as an optional dependency. In production, as Temporal recommends, the code is bundled once ahead of time: `node build-workflow-bundle.ts <directory>` (`buildWorkflowBundle`) bundles it with exactly what the worker's own bundler is given, so the sandbox is the same, and writes beside the code a manifest of the SHA-256 of the code and of what it was built from: `pnpm-lock.yaml`, the patches and every source file of this package. The worker loads it when `ORCHESTRATION_WORKFLOW_BUNDLE` names its directory; the server checks it first with `verifiedWorkflowBundle` and does not start when it is missing, incomplete, edited or built from other code, naming what changed. `node check-workflow-bundle.ts <directory>` runs that check and loads Temporal's native bridge, which the image build does after copying the bundle. The replay corpus replays against such a bundle as well.

### Settings

| Variable                          | Default      | Purpose                                                                                                                                    |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TEMPORAL_ADDRESS`                |              | Address of the Temporal frontend; when it is not set, orchestration is not available                                                       |
| `TEMPORAL_NAMESPACE`              | `default`    | Temporal namespace                                                                                                                         |
| `TEMPORAL_TASK_QUEUE`             | `auto-brain` | Task queue the worker polls and workflows start on                                                                                         |
| `TEMPORAL_API_KEY`                |              | API key, for Temporal Cloud; implies TLS                                                                                                   |
| `TEMPORAL_TLS`                    | `false`      | Whether to connect with TLS                                                                                                                |
| `ORCHESTRATION_MAX_DURATION`      | `P30D`       | The most a workflow may run, an ISO 8601 duration from `PT2H` to `P365D`; checked when the server starts                                   |
| `ORCHESTRATION_NESTED_EXECUTIONS` | `32`         | How many nested executions the server's worker runs at once, from 1 to 1000; more wait in Temporal's task queue                            |
| `ORCHESTRATION_WORKFLOW_BUNDLE`   |              | Directory of a workflow bundle built ahead of time; `/app/workflow-bundle` in the image. Unset, the worker bundles the code when it starts |

### Tenancy

- The workflow id names the org, the brain, the spec and the execution; the workflow carries the org, brain, spec, its version and the execution id in its memo. They are not search attributes, which a server needs set up before it accepts them.
- The activity that executes a spec rejects a call whose org or brain is not the one of its workflow id, or whose caller belongs to another org; the activity that settles rejects an execution other than the one of its workflow id.
- A nested execution acts for the caller who started the workflow, with the permissions that caller had then.
- There is no fairness between orgs and no limit for one: the nested executions of every org share the worker's `ORCHESTRATION_NESTED_EXECUTIONS` slots, so one org's workflows can take them all, and the others' nested executions wait in the task queue in the order Temporal hands them out.
- Temporal's history of a workflow holds its document, its input, the outputs of the specs it executes and of the workflow, its events, and the identity of the caller who started it, readable by whoever can read the namespace. Access to the namespace is an operator's privilege, and this version does not encrypt payloads.

## Not in this version

Starting workflows from schedules or events, `run`, `emit`, outbound calls, catalogs and functions beyond `execute_spec`, executing a workflow from a workflow (or any spec that finishes later), checking inputs and outputs against their schemas, listening `until` a condition, correlating events, search attributes, and showing the progress of a run. A function is added by adding an activity to the activity contract (`src/workflow/activity-contract.ts`), a body to the `call` task (`src/interpreter/call-task.ts`), and its name to the policy (`src/dsl/task-policy.ts`).

## Testing

The integration tests run against a Temporal dev server that `@temporalio/testing` starts once for the test run (`temporal-test-server.ts`, which the server's tests share as `@beonauto/orchestration/temporal-test-server`), downloading the Temporal CLI on first use into the temp directory. Stopping it waits at most 10 seconds, so a dev server whose exit is never reported, as under emulation of another architecture, cannot hold the test run open. The unit tests run the interpreter over a fake host with a virtual clock (`src/testing/fake-host.ts`), and the Temporal adapter over a fake of the workflow API.

## Source

`src/index.ts` is the entry point, and `src/settings.ts` the entry for reading the settings without loading Temporal. `src/dsl` holds what reads a document and is safe in the workflow sandbox: JSON, durations, jq expressions, tasks and the policy. `src/document` parses a spec document: YAML, the DSL schema and graph, the issues and the summary. `src/interpreter` runs a workflow over the `WorkflowHost` interface. `src/workflow` is the Temporal workflow: the entry module that is bundled, and the host built on Temporal's workflow API. `src/worker` holds the worker, its activities, its settings, Temporal's runtime, the workflow bundle and its failure converter, which removes stack traces from recorded failures. `src/primitive` holds the primitive and its Temporal client, and `src/events` the event operation.
