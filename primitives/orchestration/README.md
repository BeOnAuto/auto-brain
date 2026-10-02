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

### Events

A `listen` task waits for events sent to the running execution with `send_execution_event`, an operation of this package:

| Operation              | Kind    | Route                                    | Input                                                                                               | Answer                                              | Rejections                 |
| ---------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| `send_execution_event` | command | `POST /executions/{execution_id}/events` | `execution_id`, `event` (`type`, and optional `source`, `subject`, `data` of at most 256 KiB, `id`) | `{ execution_id, event }`, with its `id` and `time` | `not_found`, `unavailable` |

An event waits in the workflow until a `listen` task takes it; an event with an id the workflow already received is ignored, so a call can be retried with the same id. A filter matches an event when every attribute it names equals the attribute of the event, or, for an attribute written as an expression, when the expression holds on it. `read: data` (the default) outputs the `data` of the events, `envelope` and `raw` the whole events.

## Execution and settling

`execute_spec` of a workflow spec starts the workflow `runWorkflowSpec` on Temporal and answers the execution `started`. The workflow id is `{org}/{brain}/{spec}/{execution id}`, and a start with an id already running answers that run, so an execution started twice runs one workflow. The execution records `{ workflow_id, run_id }`. When Temporal cannot be reached within 10 seconds, the execution is rejected with `unavailable`.

When the workflow ends, a last activity settles the execution through `executionSettler` of `@beonauto/specs`:

- **succeeded** with the output of the workflow, when it completes;
- **rejected** when an error is not caught: `invalid_input` for an error of a 4xx status other than 408 and 429 (the input led to it, and retrying the execution answers the same), and `unavailable` for every other status (a timeout, a failure to reach a spec, a server error: retrying the execution may succeed). The detail is the title or type, the detail and the instance of the error;
- **failed** when the workflow is cancelled, when it breaks down, or when its output is larger than an execution records (1048574 bytes as JSON).

Settling is an activity, so it happens once per execution however the worker fails: Temporal retries it, and settling again with the same result records nothing. A conflict, such as a workflow that ends before its execution recorded that it finishes later, is retried for 20 attempts, from 1 second apart doubling up to 1 minute, about 14 minutes in all. A workflow that fails or is cancelled ends failed or cancelled in Temporal too, after settling.

When settling fails for good, because the ledger has no such execution, because the run may not settle it, or because its last attempt failed, the workflow fails in Temporal and the execution stays `started` in the ledger. The activity tells the `reportUnsettled` the worker was given, with the org, the brain, the execution id and the reason, never the input or output, so an operator sees an error in the log of the server and a failed workflow in Temporal under the same id. Reconciling such an execution is manual in this version. A last attempt that times out instead of failing is not reported; it shows only in Temporal.

Each workflow starts with an execution timeout of `ORCHESTRATION_MAX_DURATION`. Temporal ends a workflow that reaches it without running any more of its code, so nothing could settle its execution then. Instead, the workflow sets its own deadline an hour earlier, a durable timer it starts with its first task: when that fires it cancels what is running, settles its execution failed, and fails in Temporal with the type `WorkflowRanTooLong` and a message saying how long it ran, which is the reason an operator reads, since a failed execution carries none in the ledger. Only if no worker runs the workflow at all during that last hour does Temporal's timeout end it unsettled; the execution then stays `started`, nothing is reported, and Temporal shows the workflow timed out.

Limits keep a workflow inside what Temporal holds: a call rejects an input larger than an execution takes, an activity fails an output larger than 1 MiB, and a workflow stops with a `runtime` error before its history passes 40 MiB or 40000 events, or once it has run 10000 tasks without waiting for anything (the timers that let other workflows run do not count as waiting). [The work of expressions](#the-work-of-expressions) has its own limits.

### Determinism and replay

The interpreter runs in Temporal's workflow sandbox and must make the same decisions when a history is replayed. The entry module removes Node's `Temporal` global, whose clock reads real time; expressions get the time of the workflow; `localtime` and `strflocaltime`, which read the time zone of the host, are rejected; jitter draws from the deterministic random of the workflow.

`histories/` holds histories recorded from the integration tests, one for each path of the interpreter that issues commands: a call of `execute_spec` and a `set` (`execute-spec`), a `try` retried with backoff on timers (`retry-with-backoff`), a caught error that recovers through `catch.do` (`catch-do-recovery`), a `raise` nobody catches (`uncaught-error`), a `wait` (`timer`), a `for` loop that waits (`for-with-wait`), a fork (`parallel-fork`) and a fork that competes, cancelling the slower branch (`fork-compete`), a `listen` that takes events sent while it waits (`listen-signals`), a `timeout` that fires and is caught (`timeout-fires`), a `switch` (`switch`), a `then` that jumps back to an earlier task (`then-jump-back`), a cancelled workflow (`cancelled`), a worker killed while it runs one (`worker-restart`), and the probe of Node's `Temporal` global (`temporal-global`); every one also starts and cancels the deadline timer. `src/workflow/replay.test.ts` replays every one against the interpreter, so a change that alters the commands a workflow issues fails a test. To record them again, deliberately, run `RECORD_HISTORIES=1 pnpm --filter @beonauto/orchestration test` and then `pnpm format`. A change to what the interpreter issues must keep old histories replaying: guard it with Temporal's patching (`patched`), keep the old histories, and add new ones.

## Running it

The server does not wire the primitive in yet, so it serves no workflows. A composition root wires it in like this when the settings name a Temporal server:

```ts
import {
  connectOrchestration,
  defineSendExecutionEvent,
  makeOrchestration,
  runOrchestrationWorker,
  specExecutionResultOf,
  TemporalSettingsConfig,
  type ExecuteSpec,
  type UnsettledExecution,
} from '@beonauto/orchestration';
import { executionSettler } from '@beonauto/specs';

const temporal = yield * TemporalSettingsConfig; // Option.none() when TEMPORAL_ADDRESS is not set
// with Option.some(settings):
const client = yield * connectOrchestration(settings); // scoped
const orchestration = makeOrchestration({ client }); // a Primitive for makeSpecOperations
const sendExecutionEvent = defineSendExecutionEvent(client); // a brain operation for the catalog
const executeSpec: ExecuteSpec = ({ org, brain, caller, primitive, name, input, executionId }) =>
  dispatcher
    .dispatchToBrain(executeSpecOperation.registration, {
      caller,
      org,
      brain,
      input: { primitive, name, input, execution_id: executionId },
      encoding: 'json',
    })
    .pipe(Effect.provide(services), Effect.map(specExecutionResultOf));
const onFailure = (detail: string) => logIncident(detail); // the server decides what follows
const reportUnsettled = ({ org, brain, executionId, reason }: UnsettledExecution) =>
  logError('An execution stays started', { org, brain, executionId, reason });
yield * runOrchestrationWorker({ settings, executeSpec, settle: executionSettler(ledger), reportUnsettled, onFailure }); // scoped
```

`runOrchestrationWorker` connects to Temporal, bundles the workflow code when it starts (there is no build step), runs the worker inside the server process, and shuts it down when its scope closes: activities in flight get 10 seconds to finish, and are then left to Temporal's retries, and then its connection closes. It fails with `OrchestrationWorkerError` when Temporal cannot be reached or the worker cannot be made, closing the connection it opened.

The server owns the process's signals. The worker installs Temporal's runtime with no `shutdownSignals`, so a `SIGTERM` does not stop the worker behind the server's back; it refuses to start under a runtime installed earlier with shutdown signals. Stopping a worker that already stopped is harmless.

A worker that stops on its own, because its run fails (Temporal unreachable for good, a fatal worker error) or ends without being asked to, calls `onFailure` once with a detail saying why; stopping it when its scope closes calls nothing. While the worker is down, executing a workflow spec still answers `started` whenever Temporal accepts the start, and `unavailable` only when it does not; the workflow waits on its task queue until a worker polls it again.

### Settings

| Variable                     | Default      | Purpose                                                                                                  |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `TEMPORAL_ADDRESS`           |              | Address of the Temporal frontend; when it is not set, orchestration is not available                     |
| `TEMPORAL_NAMESPACE`         | `default`    | Temporal namespace                                                                                       |
| `TEMPORAL_TASK_QUEUE`        | `auto-brain` | Task queue the worker polls and workflows start on                                                       |
| `TEMPORAL_API_KEY`           |              | API key, for Temporal Cloud; implies TLS                                                                 |
| `TEMPORAL_TLS`               | `false`      | Whether to connect with TLS                                                                              |
| `ORCHESTRATION_MAX_DURATION` | `P30D`       | The most a workflow may run, an ISO 8601 duration from `PT2H` to `P365D`; checked when the server starts |

### Tenancy

- The workflow id names the org, the brain, the spec and the execution; the workflow carries the org, brain, spec, its version and the execution id in its memo. They are not search attributes, which a server needs set up before it accepts them.
- The activity that executes a spec rejects a call whose org or brain is not the one of its workflow id, or whose caller belongs to another org; the activity that settles rejects an execution other than the one of its workflow id.
- A nested execution acts for the caller who started the workflow, with the permissions that caller had then.
- Temporal's history of a workflow holds its document, its input, the outputs of the specs it executes and of the workflow, its events, and the identity of the caller who started it, readable by whoever can read the namespace. Access to the namespace is an operator's privilege, and this version does not encrypt payloads.

## Not in this version

Starting workflows from schedules or events, `run`, `emit`, outbound calls, catalogs and functions beyond `execute_spec`, executing a workflow from a workflow (or any spec that finishes later), checking inputs and outputs against their schemas, listening `until` a condition, correlating events, search attributes, and showing the progress of a run. A function is added by adding an activity to the activity contract (`src/workflow/activity-contract.ts`), a body to the `call` task (`src/interpreter/call-task.ts`), and its name to the policy (`src/dsl/task-policy.ts`).

## Testing

The integration tests run against a Temporal dev server that `@temporalio/testing` starts once for the test run (`temporal-test-server.ts`), downloading the Temporal CLI on first use into the temp directory. Stopping it waits at most 10 seconds, so a dev server whose exit is never reported, as under emulation of another architecture, cannot hold the test run open. The unit tests run the interpreter over a fake host with a virtual clock (`src/testing/fake-host.ts`), and the Temporal adapter over a fake of the workflow API.

## Source

`src/index.ts` is the only entry point. `src/dsl` holds what reads a document and is safe in the workflow sandbox: JSON, durations, jq expressions, tasks and the policy. `src/document` parses a spec document: YAML, the DSL schema and graph, the issues and the summary. `src/interpreter` runs a workflow over the `WorkflowHost` interface. `src/workflow` is the Temporal workflow: the entry module that is bundled, and the host built on Temporal's workflow API. `src/worker` holds the worker, its activities, its settings and its failure converter, which removes stack traces from recorded failures. `src/primitive` holds the primitive and its Temporal client, and `src/events` the event operation.
