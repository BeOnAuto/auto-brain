# Workflows and runs

A workflow is a saved definition that coordinates a brain's functions through steps. It can run reasoning functions in order, choose a path from their results, loop over items, run branches in parallel, wait for an event or a timer, retry a step that failed and give up after a time limit. A run keeps its place across a restart of the runtime: it goes on from where it was, waiting or working. Every runtime offers workflows; [Functions and availability](functions.md#availability) shows how to see them on your connection.

[Workflow format](../reference/workflow-format.md) describes the document, and the [HTTP](../reference/http.md#workflows) and [MCP](../reference/mcp.md) references list the operations.

## Coordinate reusable work

A function defines a reusable operation; a step is where a workflow uses it. A reasoning function such as `review-campaign-brief` can be called directly by an agent and used as a step in more than one workflow. Other steps decide what happens next, wait, repeat work or handle errors without calling a function.

In the current runtime, the functions a workflow calls are reasoning functions in the same brain. A workflow reaches outside the brain only through those functions: it makes no network calls of its own. Check [Functions and availability](functions.md#availability) before planning a step around another function type.

A budget-review workflow could assess the options with a reasoning function, then wait for a person's approval. The evidence arrives as the run's input or with an event, and the approval is an event sent to the waiting run. [Build your first workflow](../tutorials/first-workflow.md) builds a small version: it reviews a campaign brief, waits for the revised brief, and reviews that.

## Definitions, versions and runs

Keep the saved work separate from what happens when it executes:

| Term       | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| Definition | The reusable function or workflow someone creates    |
| Version    | A particular revision of that definition             |
| Run        | One execution against particular inputs              |
| Result     | The output of that run                               |
| Step       | One task of a workflow, such as a call to a function |
| Step run   | Execution of a particular step within a workflow run |
| Attempt    | One try at a step's work; a retry is another attempt |

Saving a workflow creates its definition at version 1, and each change to its document adds a version. A run uses the active latest version when it starts and keeps that version until it ends; the run records it as `spec_version`. A step that calls a function runs the function's active latest version at the time of the call.

Each call to a function starts a run of that function, recorded under its own execution id. A retry is a new attempt at the step: it starts another run of the function, not a new function. When the runtime resumes a step after an interruption, the step keeps its execution id, so a function run that already has a final result is not run again.

## Starting a run

A run starts when a caller executes the workflow with `execute_spec`, giving its input. The call answers at once with the run's execution id and the status `started`; the run then carries on by itself. Executing again with the same execution id and input returns that run as it stands rather than starting another. A workflow runs once for each execution id: executing again with the id of a run that ended without a result, `rejected` as `unavailable` or `failed`, is refused with `conflict`, so start a new run under a new execution id.

Every step acts for the caller who started the run, with the permissions that caller had at the start, for as long as the run lasts. The longest a run may last is 30 days unless the deployment sets a different limit, and a run still going when it reaches that limit fails.

## Waiting and answering

A run waits while a step's function runs, while a timer or a retry delay passes, and while a step listens for an event. It shows the status `started` throughout.

An event answers a waiting run. A caller sends it with `send_execution_event`, naming the run's execution id and giving the event a `type` and, usually, `data`. The event belongs to that run: it does not start another one. An event that arrives before the run listens for it is kept until a step takes it, and an event repeated with the same id is taken once, so a sender can retry safely. A run that has ended refuses events.

An approval works this way: the workflow listens for an event such as `com.example.brief.decided`, and the person's answer arrives as that event's data. A step can give up waiting after a set time and continue on another path.

## How a run ends

A run ends in one of three states:

| Status      | When                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `succeeded` | Its steps completed; the run's `output` is its result                                    |
| `rejected`  | A step raised an error that no step handled; the rejection gives the reason and the step |
| `failed`    | The run broke down inside the runtime, produced too large an output, or ran too long     |

A rejection's reason is `invalid_input` when the error says the input or the document led to it, and `unavailable` when trying again may succeed, as after a timeout. The [workflow format](../reference/workflow-format.md#how-a-run-ends) lists the exact rules.

## Inspecting a run

`get_execution` reads a run by its execution id. For a workflow it returns the workflow's name, the version that ran, who started it and when, its status and, once it ends, when it finished and its output or rejection.

`get_execution_history` reads what happened in the run, oldest first: its start, its end and, for each input the run took (its start, a function's answer, a timer or an event), a `workflow_input_applied` event. That event names the input and lists the steps it moved, each with how it ended, such as `waiting` or `completed`, so the latest one shows what the run is waiting for. It shows neither the data the run holds nor the events' data. Each function run a step started is recorded in the brain under its own execution id, which `list_executions` lists.

## Planned

Schedule triggers and event triggers are planned. A schedule trigger will hold its timing rule and timezone; an event trigger will hold its event type and matching conditions. Today a run starts only when a caller executes the workflow. Timers and event waits inside a run are control steps, not triggers for new runs.

A workflow cannot currently call another workflow. The name for that use, when supported, is a workflow step or subworkflow.
