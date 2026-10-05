# Workflows and runs

Workflows are coming soon. They will provide saved coordination for work that spans several steps; this page explains that model.

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

The planned model includes starting workflows manually, on a schedule or in response to an event. Sending input to an existing run is a separate action. An approval response belongs to the waiting work it answers.

For now, your agent can call reason functions directly through [MCP](../reference/mcp.md), then inspect their recorded runs. The [HTTP reference](../reference/http.md) covers those available operations.
