# @beonauto/orchestration

The workflow adapter parses a `WorkflowDefinitionDocument` from YAML in the Open Workflow Specification DSL. This document type is an alias for `JsonObject`; the parser applies the existing DSL checks. It is separate from the named, versioned definition stored in the registry. The adapter runs the workflow machine of [`@beonauto/workflow-engine`](../../packages/workflow-engine), hosted in Node by [`@beonauto/workflow-host`](../../packages/workflow-host). Workflows coordinate functions and control steps; they are not another function type. Its API identifier and package name are `orchestration`.

Public documentation explains [workflows and their availability](../../docs/concepts/workflows.md) and [the workflow format](../../docs/reference/workflow-format.md), published at [on.auto/docs](https://on.auto/docs/). The repository-only [workflow execution reference](../../docs/engineering/reference/workflow-format.md) and [workflow operations guide](../../docs/engineering/self-host/workflows.md) hold the implementation details, and [decision 0001](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) why workflows run on an engine on the ledger.

## Entry

`src/index.ts` exports:

- `makeWorkflowAdapter({ runs, mostDurationMs, longestCallMs })`: the workflow adapter, with `WorkflowAdapterDependencies` as its options type. `runs` is the host that starts runs; `mostDurationMs` is the most a run may last, which `create_spec` checks every duration of a document against and a run is stopped at exactly; `longestCallMs` the most a call of a run may take before its `call_deadline` timer fails the task.
- `defineSendExecutionEvent(runs)`: `send_execution_event`, which gives a running workflow an event.
- `orchestrationMachine`: the machine's options, the functions a workflow may call (`execute_spec`) and the runtime its expressions see as `$runtime`.
- `definitionCalls(runDefinition)`: calls a saved definition from a workflow. This adapter accepts reasoning functions and custom definition types; it does not classify every extension as a brain function.
- `runPresenter`: the presenter of the run log, for the history of a run and the events of a brain.
- `definitionRunResultOf`, `RunDefinition`, `DefinitionRunRequest` and `DefinitionRunResult`, for the server, which runs a definition called by a workflow through its operations.

## A run of a workflow

`execute_spec` of a workflow starts its run with the `started` input: the document, the input, the run's limits, a random seed for the draws of the run, and as attributes the org, the brain, the execution id, the spec's name and version and the caller who started it. The run's log is `runs/<execution id>` under the brain, so a run belongs to one execution, and the execution records that it finishes later, with an empty record, and stays `started` until the run settles it. A retry with the execution id of a run that is going answers the execution as it stands. A run never starts twice in one log, so a retry with the execution id of a run that ended and settled its execution without a final result, `unavailable` or `failed`, is rejected with `conflict`: run the workflow again under a new execution id. While the server is stopping, `execute_spec` of a workflow is rejected with `unavailable`.

`send_execution_event` gives the run an `event_received` input. An event the run took before is answered as delivered, since an event is taken once by its id; a run that has not started yet, or has ended, is `not_found`; and a run that cannot take the event at that moment, because its log kept changing or the server is stopping, is `unavailable`. Since a `listen` filter matches on the event's attributes, an event may not take a type or a source of what the brain records itself: `refusingTheBrainsOwnAttributes` of `@beonauto/specs` refuses them with `invalid_input` at `/event/type` and `/event/source`, as `publish_event` does. Its text follows the rules of a published event too, through `refusingForbiddenCharacters` and `refusingBlankText` of `@beonauto/specs`: no control character, lone surrogate or noncharacter, and a type, id and subject that hold a character that is not a space.

A call of a workflow, `call: execute_spec`, executes the spec it names through the operations for the caller who started the run, under an execution id derived from the workflow's execution id, the task and the run of the task (`src/calls/nested-execution-id.ts`), so a call started again is the same execution. Arguments that name no spec a workflow may execute, or a workflow, which a workflow may not execute, are rejected as `invalid_arguments`, a `validation` error of the task. A rejection keeps its issues in its detail and its `kind` and `because`, which the error of the task carries for a `catch` to read, and an output of more than 1 MiB fails the call.

## Histories

`runPresenter` presents each event of a run log, `input_applied`, as one public event, `workflow_input_applied`: the kind and key of the input (the execution id for a start or a cancel, the timer id, the call key or the event id), the status of an answer, with the kind and because of a rejection that names them as `rejection`, which the summary also says in words, and the type of an event, the count of the steps the input moved and the first five, each with its task, run and outcome, and the kinds of output it made. The patch is never shown. Keys, types and task references are cut at 256 bytes, so the data stays within 4 KiB at the largest event a run stores (`src/presenting/run-presenter.test.ts`). The history of a run then shows its steps between its start and its end.

## Testing

`src/workflows` holds the tests of how a workflow runs, each a document run through the memory driver of the engine (`src/testing/workflows.ts`, `interpret`), with the commands a run gave its ports and the settlement it ended with. `src/input-logs` holds fifteen recorded paths, whose input logs in `input-logs/` are the replay corpus: each replays through the machine to the events it recorded, and each runs today as it was recorded (`RECORD_INPUT_LOGS=1` records them again). The primitive and `send_execution_event` are tested on a brain whose workflows run on a host over a private SQLite database in memory (`src/testing/orchestrated-brain.ts`).

## Source

`src/document` parses a spec document: YAML, the DSL schema and graph, the policy, the issues and the summary. `src/primitive` holds the primitive and its description, `src/events` the event operation, `src/calls` what a call of a workflow does, `src/runs` the machine's options and a run's attributes, `src/presenting` the presenter of a run's log, `src/workflows` the tests of how a workflow runs, `src/input-logs` the recorded paths and their corpus, and `src/testing` what the tests share.
