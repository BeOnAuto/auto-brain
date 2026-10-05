# Workflows and runs

Workflows are saved coordination for work that spans several steps. A run of a workflow calls functions, waits for time to pass or for an event, and goes on where it was after the runtime restarts; this page explains that model.

## Coordinate reusable work

A workflow coordinates steps, dependencies and conditions around a piece of work. A function defines a reusable operation; a step is where a workflow uses it. A reason function such as `assess-budget-options` can be called directly by an agent and reused across workflows.

A budget-review workflow could gather the required evidence, assess options and request approval. These are illustrative steps, not a claim that each function type is available. Check [Functions and availability](functions.md).

## Definitions, versions and runs

Keep the saved work separate from what happens when it executes:

| Term       | Meaning                                           |
| ---------- | ------------------------------------------------- |
| Definition | The reusable function or workflow someone creates |
| Version    | A particular revision of that definition          |
| Run        | One execution against particular inputs           |
| Result     | The output of that run                            |

A workflow's detailed run history can contain step runs and attempts. A retry is an attempt within the execution model; it does not create a new business function.

## Starting and resuming work

You start a workflow run yourself, through [MCP](../reference/mcp.md) or [HTTP](../reference/http.md#workflows). Starting workflows on a schedule or in response to an event is planned, not available. Sending an event to an existing run is a separate action: an approval response belongs to the waiting work it answers, and does not start another run.

A run's history shows, for each input it took, such as its start, a function's answer or an event, the steps that moved and how they ended. Your agent can start workflows, send a waiting run its event and inspect recorded runs through the same operations as for reason functions.
