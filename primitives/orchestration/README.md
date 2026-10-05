# @beonauto/orchestration

The current Temporal-backed workflow implementation. The runtime identifier remains `orchestration`.

Public documentation explains [workflows and their availability](../../docs/concepts/workflows.md), published at [on.auto/docs](https://on.auto/docs/). Contributor setup and the current implementation details remain in the repository-only [workflow reference](../../docs/engineering/reference/workflow-format.md) and [workflow operations guide](../../docs/engineering/self-host/temporal.md). Update those notes alongside behavior changes while the engine transition is in progress.

## Testing

The integration tests run against a Temporal dev server that `@temporalio/testing` starts once for the test run (`temporal-test-server.ts`, which the server's tests share as `@beonauto/orchestration/temporal-test-server`), downloading the Temporal CLI on first use into the temp directory. Stopping it waits at most 10 seconds, so a dev server whose exit is never reported, as under emulation of another architecture, cannot hold the test run open. The unit tests run the interpreter over a fake host with a virtual clock (`src/testing/fake-host.ts`), and the Temporal adapter over a fake of the workflow API.

## Source

`src/index.ts` is the entry point, and `src/settings.ts` the entry for reading the settings without loading Temporal. What reads a document and is safe in the workflow sandbox, JSON, durations, jq expressions, tasks and the policy, is the DSL of `@beonauto/workflow-engine` (`packages/workflow-engine/src/dsl`), imported through the package's `dsl/*` entry, so the bundled workflow code takes neither Effect nor the ledger from the engine's main entry. `src/document` parses a spec document: YAML, the DSL schema and graph, the issues and the summary. `src/interpreter` runs a workflow over the `WorkflowHost` interface. `src/workflow` is the Temporal workflow: the entry module that is bundled, and the host built on Temporal's workflow API. `src/worker` holds the worker, its activities, its settings, Temporal's runtime, the workflow bundle and its failure converter, which removes stack traces from recorded failures. `src/primitive` holds the primitive and its Temporal client, and `src/events` the event operation.
