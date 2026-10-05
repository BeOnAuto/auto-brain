# Workflows and Temporal

The server runs the Temporal worker for its workflows in its own process, on the task queue `TEMPORAL_TASK_QUEUE`; give each deployment its own task queue, or its own namespace, so that no other deployment's worker takes its workflows. In development, `pnpm dev` runs Temporal for you.

The server starts whether Temporal can be reached or not. Until it can, it logs a warning each time it tries to start the worker, and executing a workflow spec answers `503` `unavailable`; once Temporal is back, workflows run without a restart. When the server stops, it stops accepting requests, gives the activities in flight 10 seconds to finish while the requests in flight finish, and then closes the ledger. With Temporal unreachable and requests waiting for it, stopping can take up to about 16 seconds, so allow the container at least 20 (`docker stop --time 20`).

Give the container at least 512 MiB of memory without workflows and 1 GiB with them (`docker run --memory 1g`). The [orchestration README](../reference/workflow-format.md#memory) has the measurements behind these figures and the bound on what workflows can hold.

What an operator must know:

- Temporal's history of each workflow holds its document, its input, the outputs of the specs it executes, the events sent to it and the identity of the caller who started it, unencrypted in this version: whoever can read the namespace can read that tenant data. Access to the namespace is an operator's privilege; grant it accordingly.
- A workflow acts for the caller who started it, with the permissions that caller had then, for as long as it runs, at most `ORCHESTRATION_MAX_DURATION`. Revoking the caller's key does not stop it. To stop one, `temporal workflow cancel --workflow-id <org>/<brain>/<spec>/<execution id>` cancels what it is doing and settles its execution `failed`, and the workflow ends `CANCELLED` in Temporal; `temporal workflow terminate` ends it without running any more of its code, so its execution stays `started`.
- `/health` answers whether the server is alive, not whether its workflow worker runs; the log says that (`The workflow worker started`, and the warnings above).
- There are no limits for one org, and no fairness between orgs: every org's workflows share the server's worker, its 16 cached workflows, its 2 workflow tasks and its `ORCHESTRATION_NESTED_EXECUTIONS` nested executions at a time.
- An execution whose workflow could not settle it stays `started`; the server logs it as an error with its org, brain, execution id and reason, and reconciling it is manual in this version.
