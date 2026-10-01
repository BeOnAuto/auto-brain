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

| Allowed                                                                       | Refused in this version                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `set`, `do`, `switch`, `for` (with `while`), `fork` (with `compete`)          | `run` (shell, script, container, workflow) and `emit`                                                    |
| `call: execute_spec`                                                          | `call` of `http`, `grpc`, `openapi`, `asyncapi`, `a2a`, `mcp`, or of any other function                  |
| `try` with `catch` (`errors.with`, `as`, `when`, `exceptWhen`, `retry`, `do`) | `use.catalogs`, `use.extensions`, `use.functions`, `use.secrets`, `use.authentications`, and `schedule`  |
| `raise`, `wait`, `listen` (`one`, `all`, `any`; `read`)                       | `listen` with `until`, `foreach` or `correlate`; schemas on tasks; schemas not inline or not JSON Schema |
| `then: continue`, `exit`, `end`, or the name of a task in the same list       | executing an orchestration spec from a workflow                                                          |
| `if`, `input.from`, `output.as`, `export.as`, `timeout`                       | the jq builtins `localtime` and `strflocaltime`; durations in years or months                            |

Creating or updating a spec checks its document fully: it reads the YAML without aliases, anchors or tags, validates it against the DSL schema and its rules, builds its graph of tasks, and applies the policy above. Every problem is an issue under `/source` with the line, the column and the JSON Pointer of the place: `Line 8, column 12: at /do/0/loop/for: It needs in`. The interpreter applies the refusals again when a workflow starts, so a document that never went through the spec operations cannot run what the policy refuses.

### Expressions

Expressions are [jq](https://jqlang.org), evaluated by `@gabrielbryk/jq-ts` inside the workflow. A string enclosed in `${ }` is an expression wherever the DSL takes a value; `if`, `when`, `exceptWhen`, `for.in`, `while`, and the strings of `input.from`, `output.as` and `export.as` are expressions even without `${ }`. They see `.` (the data of the step), `$context` (what tasks exported), `$input`, `$output` (in `export.as`), `$task` (`name`, `reference`, `definition`, `input`, `startedAt`, and `output` after the task ran), `$workflow` (`id`, the execution id; `definition`; `input`; `startedAt`), `$runtime` (`name: auto-brain`), and the variables of loops (`$item` and `$index` unless named with `each` and `at`) and catches (`$error` unless named with `as`). `now` is the time of the workflow, recorded in its history, never the clock of the host.

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

Settling is an activity, so it happens once per execution however the worker fails: Temporal retries it, and settling again with the same result records nothing. A conflict, such as a workflow that ends before its execution recorded that it finishes later, is retried for about 15 minutes. A workflow that fails or is cancelled ends failed or cancelled in Temporal too, after settling.

Limits keep a workflow inside what Temporal holds: a call refuses an input larger than an execution takes, an activity fails an output larger than 1 MiB, and a workflow stops with a `runtime` error before its history passes 40 MiB or 40000 events, or once it has run 10000 tasks without waiting for anything.

### Determinism and replay

The interpreter runs in Temporal's workflow sandbox and must make the same decisions when a history is replayed. The entry module removes Node's `Temporal` global, whose clock reads real time; expressions get the time of the workflow; `localtime` and `strflocaltime`, which read the time zone of the host, are refused; jitter draws from the deterministic random of the workflow.

`histories/` holds histories recorded from the integration tests, and `src/workflow/replay.test.ts` replays every one against the interpreter, so a change that alters the commands a workflow issues fails a test. To record them again, deliberately, run `RECORD_HISTORIES=1 pnpm --filter @beonauto/orchestration test` and then `pnpm format`. A change to what the interpreter issues must keep old histories replaying: guard it with Temporal's patching (`patched`), keep the old histories, and add new ones.

## Running it

The server's composition root wires the primitive in when the settings name a Temporal server:

```ts
import {
  connectOrchestration,
  defineSendExecutionEvent,
  makeOrchestration,
  runOrchestrationWorker,
  specExecutionResultOf,
  TemporalSettingsConfig,
  type ExecuteSpec,
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
yield * runOrchestrationWorker({ settings, executeSpec, settle: executionSettler(ledger) }); // scoped
```

`runOrchestrationWorker` connects to Temporal, bundles the workflow code when it starts (there is no build step), runs the worker inside the server process, and shuts it down when its scope closes: activities in flight get 10 seconds to finish, and are then left to Temporal's retries. It fails with `OrchestrationWorkerError` when Temporal cannot be reached or the worker cannot be made.

### Settings

| Variable              | Default      | Purpose                                                                              |
| --------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `TEMPORAL_ADDRESS`    |              | Address of the Temporal frontend; when it is not set, orchestration is not available |
| `TEMPORAL_NAMESPACE`  | `default`    | Temporal namespace                                                                   |
| `TEMPORAL_TASK_QUEUE` | `auto-brain` | Task queue the worker polls and workflows start on                                   |
| `TEMPORAL_API_KEY`    |              | API key, for Temporal Cloud; implies TLS                                             |
| `TEMPORAL_TLS`        | `false`      | Whether to connect with TLS                                                          |

### Tenancy

- The workflow id names the org, the brain, the spec and the execution; the workflow carries the org, brain, spec, its version and the execution id in its memo. They are not search attributes, which a server needs set up before it accepts them.
- The activity that executes a spec refuses a call whose org or brain is not the one of its workflow id, or whose caller belongs to another org; the activity that settles refuses an execution other than the one of its workflow id.
- A nested execution acts for the caller who started the workflow, with the permissions that caller had then.

## Not in this version

Starting workflows from schedules or events, `run`, `emit`, outbound calls, catalogs and functions beyond `execute_spec`, executing a workflow from a workflow (or any spec that finishes later), checking inputs and outputs against their schemas, listening `until` a condition, correlating events, search attributes, and showing the progress of a run. A function is added by adding an activity to the activity contract (`src/workflow/activity-contract.ts`), a body to the `call` task (`src/interpreter/call-task.ts`), and its name to the policy (`src/dsl/task-policy.ts`).

## Testing

The integration tests run against a Temporal dev server that `@temporalio/testing` starts once for the test run (`temporal-test-server.ts`), downloading the Temporal CLI on first use into the temp directory. The unit tests run the interpreter over a fake host with a virtual clock (`src/testing/fake-host.ts`), and the Temporal adapter over a fake of the workflow API.

## Source

`src/index.ts` is the only entry point. `src/dsl` holds what reads a document and is safe in the workflow sandbox: JSON, durations, jq expressions, tasks and the policy. `src/document` parses a spec document: YAML, the DSL schema and graph, the issues and the summary. `src/interpreter` runs a workflow over the `WorkflowHost` interface. `src/workflow` is the Temporal workflow: the entry module that is bundled, and the host built on Temporal's workflow API. `src/worker` holds the worker, its activities, its settings and its failure converter, which removes stack traces from recorded failures. `src/primitive` holds the primitive and its Temporal client, and `src/events` the event operation.
