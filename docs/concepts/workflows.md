# Workflows and runs

A workflow is a saved definition that coordinates a brain's functions through steps. It can run reasoning functions in order, choose a path from their results, loop over items, run branches in parallel, wait for an event or a timer, retry a step that failed and give up after a time limit. A run keeps its place across a restart of the runtime: it goes on from where it was, waiting or working. Every runtime offers workflows; [Functions and availability](functions.md#availability) shows how to see them on your connection.

[Workflow format](../reference/workflow-format.md) describes the document, and the [HTTP](../reference/http.md#workflows) and [MCP](../reference/mcp.md) references list the operations.

## Coordinate reusable work

A function defines a reusable operation; a step is where a workflow uses it. A reasoning function such as `review-campaign-brief` can be called directly by an agent and used as a step in more than one workflow. Other steps decide what happens next, wait, repeat work or handle errors without calling a function.

In the current runtime, the functions a workflow calls are reasoning functions in the same brain and, in a self-hosted runtime, interaction, computation and recall functions. A workflow reaches outside the brain only through those functions: it makes no network calls of its own, an interaction function reaches only the tools of the tool servers the runtime's operator configures, and a computation or recall function reaches nothing outside. Check [Functions and availability](functions.md#availability) before planning a step around another function type.

A budget-review workflow could assess the options with a reasoning function, then ask a person to approve them with an interaction function. The evidence arrives as the run's input or with an event, and the approval is the answer to the interaction function's request. [Build your first workflow](../tutorials/first-workflow.md) builds a small version: it reviews a campaign brief, then asks its owner to approve it through the brain's inbox.

## Definitions, versions and runs

Keep the saved work separate from what happens when it executes:

| Term       | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| Definition | The reusable function or workflow someone creates    |
| Version    | A particular revision of that definition             |
| Run        | One run against particular inputs                    |
| Result     | The output of that run                               |
| Step       | One task of a workflow, such as a call to a function |
| Step run   | Run of a particular step within a workflow run       |
| Attempt    | One try at a step's work; a retry is another attempt |

Saving a workflow creates its definition at version 1, and each change to its document adds a version. A run uses the active latest version when it starts and keeps that version until it ends; the run records it as `definition_version`. A step that calls a function runs the function's active latest version at the time of the call.

Each call to a function starts a run of that function, recorded under its own run id. A retry is a new attempt at the step: it starts another run of the function, not a new function. When the runtime resumes a step after an interruption, the step keeps its run id, so a function run that already has a final result is not run again. A reasoning function's run is not run again under its id either when it had recorded a tool call and did not succeed, or when its function names tools and the run had started without ending, since its tools may have changed something. The step then fails with an error of the type `https://on.auto/problems/tools_called`, which a retry of runtime or communication errors does not catch; a retry that catches every error, or names that type, calls the function again under a new run id, and so calls its tools again. The run's history shows what the function called.

## Starting a run

A run starts when a caller executes the workflow with `run_definition`, giving its input. The call answers at once with the run's run id and the status `started`; the run then carries on by itself. Executing again with the same run id and input returns that run as it stands rather than starting another. A workflow runs once for each run id: executing again with the id of a run that ended without a result, `rejected` as `unavailable` or `failed`, is refused with `conflict`, so start a new run under a new run id.

A run also starts when a trigger of the workflow fires, as the next section describes.

Every step acts for the caller who started the run, with the permissions that caller had at the start, for as long as the run lasts. The longest a run may last is 30 days unless the deployment sets a different limit, and a run still going when it reaches that limit fails.

## Triggers

A workflow can start on its own. Its document's `schedule` names up to three triggers, one of each kind, each kept and matched on its own:

- An **event trigger**, `on`, starts a run for each event of the brain that one of its filters matches: an event published with `publish_event`, an event another workflow emits, or one of the brain's own facts, such as a reasoning function's run that succeeded. The run's input is a list holding the event. It takes at most 64 filters.
- A **schedule trigger** starts a run at the times a `cron` rule names, in UTC, or `every` period of at least a minute, counted from when the trigger was saved as it is. The run's input says when it was due. One run of a schedule trigger runs at a time: a time due while the run it started before still runs is skipped.

So a workflow can start on an event and at its times without switching between them. Each trigger is identified by its kind, `event`, `cron` or `every`, and its place in the document, such as `/schedule/cron`; a saved workflow shows its triggers that way, and a run says which trigger started it.

A run a trigger starts acts as the brain itself, shown as `brain:` and the brain's name in `started_by`, rather than for a person. A trigger applies from when it is saved as it is, never to what the brain recorded before: a new version that leaves a trigger unchanged keeps it going as it was, with its times, while a trigger the version changes or adds applies from that version on. Each event or due time starts its run once, even across a restart of the runtime.

A workflow does not start for its own runs or for the events they emit, a chain of runs started by events stops at a depth of 8, and its event trigger starts at most 60 runs of it a minute. What a trigger did not start appears among the brain's events as `reaction_refused`. The [workflow format](../reference/workflow-format.md#triggers) gives the exact rules.

A workflow can also announce something with an `emit` step, which records an event in the brain; another workflow's event trigger, or a run waiting for that event, can take it.

## Waiting and answering

A run waits while a step's function runs, while a timer or a retry delay passes, and while a step listens for an event. It shows the status `started` throughout.

An event answers a waiting run. A caller sends it with `send_run_event`, naming the run's run id and giving the event a `type` and, usually, `data`. The event belongs to that run: it does not start another one. An event that arrives before the run listens for it is kept until a step takes it, and an event repeated with the same id is taken once, so a sender can retry safely. A run that has ended refuses events.

A step that listens for an event whose type it names also hears the events of the whole brain while it listens: one published with `publish_event`, emitted by another workflow, or one of the brain's facts. The run checks the event against its own filter, so it can take only the event about the case it handles. An event published before the step listened, or after it stopped, does not reach it; send the event to the run itself when it must not be missed.

An approval is an interaction function. The workflow calls it as it calls any function; the function's run asks the person, through the brain's inbox or a tool the function names, such as one that posts in a chat, and the workflow waits, holding nothing of the runtime, until someone answers with `answer_interaction` or the person's reply answers it. The answer, checked against the function's answer schema, is the output of that call. A request nobody answers before it expires raises an `unanswered` error, which a workflow can catch to take another path, and the function's `expires` bounds how long the workflow waits. Events remain for input that is not the answer to a question.

## How a run ends

A run ends in one of three states:

| Status      | When                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `succeeded` | Its steps completed; the run's `output` is its result                                    |
| `rejected`  | A step raised an error that no step handled; the rejection gives the reason and the step |
| `failed`    | The run broke down inside the runtime                                                    |

A run that was cancelled, or that ran as long as a run may last, is `rejected` with the reason `cancelled` and the kind of its cancellation, a run that did not catch a request nobody answered is `rejected` as `unanswered` with the kind `expired` or `undelivered`, and a run whose output is too large to record is `rejected` as a `conflict` of the kind `oversized`.

A rejection's reason is `invalid_input` when the error says the input or the document led to it, and `unavailable` when it was a timeout or a function that could not be reached, failed or was unavailable; a new run may then succeed. Two endings are different, because a reasoning function's tools may have changed something: `unavailable` of the kind `tools_unfinished`, when it called tools and could not finish, and `conflict` of the kind `tools_called`, when a step met a function run whose tools may already have been called. After either, check what the run's history shows the function called before starting a new run. The [workflow format](../reference/workflow-format.md#how-a-run-ends) lists the exact rules.

## Calling another workflow

A workflow calls another workflow with `run_definition`, as it calls any function of its brain; the workflow it calls is a subworkflow. A run of a reasoning, computation or recall function finishes within its call. A run of a workflow, like a run of an interaction function, finishes later, so the calling workflow waits for that run, holding nothing of the server while it waits, and continues with its output, or catches its rejection like any error. A server that restarts meanwhile keeps the wait, and the subworkflow's ending answers it on whichever server that ending is recorded.

A call waits as long as the function it names may take, plus a minute; past that, it raises a `timeout` error and the run it waited for is cancelled. Workflows that call workflows reach 8 calls deep, and the runs under one workflow wait for at most 1,000 calls at once.

## Cancelling a run

`cancel_run` cancels a workflow run that has not ended, with a reason the run keeps. The request is recorded at once, so it can reach any server and outlasts a restart; the run then stops, cancels each run it waits for, and ends `rejected` as `cancelled` with the kind `requested`. `cancel_run` also cancels the run of an interaction function whose request waits, which ends `rejected` as `cancelled`. A run of a reasoning, computation or recall function ends within its call, and cannot be cancelled from outside it.

## Inspecting a run

`get_run` reads a run by its run id. For a workflow it returns the workflow's name, the version that ran, who started it and when, its status and, once it ends, when it finished and its output or rejection.

`get_run_history` reads what happened in the run, oldest first: its start, its end and, for each input the run took (its start, a function's answer, a timer or an event), a `workflow_input_applied` event. That event names the input and lists the steps it moved, each with how it ended, such as `waiting` or `completed`, so the latest one shows what the run is waiting for; an event for each step follows it, named for how the step ended that input, such as `step_waiting` or `step_finished`. Every event names the event that led to it, so the history draws as a graph: the branch a `switch` took, the branches of a `fork`, a retry and a wait. A step that calls a function shows the run id of the function's run on its `step_waiting` event, and `list_brain_events` with the workflow's `run_id` reads the workflow and every function run it started together. It shows neither the data the run holds nor the events' data. Each function run a step started is recorded in the brain under its own run id, which `list_runs` lists.

## Planned

A schedule trigger reads its times in UTC; time zones are planned. Starting one run from several events that belong together is planned too. Timers and event waits inside a run are control steps, not triggers for new runs.
