# @beonauto/specs

The definition and run operations of auto-brain: create, list, read, update, retire and run a brain's function and workflow definitions, then inspect their runs and history. They are defined on the application layer, [`@beonauto/operations`](../operations).

## Definitions, runs and runtime adapters

`Definition` is a named, versioned definition stored in one brain. A reasoning function uses Markdown with YAML front matter; a workflow uses a YAML document. `ListedDefinition` is the same view without the source document. A `Run` executes a definition against particular inputs and records how it ended; `RunDetail` includes the detailed record.

`BrainFunctionDefinition` covers the currently implemented `ReasoningFunctionDefinition`; `WorkflowDefinition` identifies a stored workflow. `FunctionRun` and `WorkflowRun` identify their runs. The guards `isBrainFunctionDefinition`, `isWorkflowDefinition`, `isFunctionRun` and `isWorkflowRun` narrow decoded records by their `primitive` without copying or modifying them. Planned function kinds and custom adapters are not classified as implemented brain functions. The generic `Definition` and `Run` types still support extension adapters.

These are stored records with names, versions and audit fields. The adapters' parsed source configurations use the separate names `ReasoningFunctionDefinitionDocument` and `WorkflowDefinitionDocument`.

`Primitive` is the low-level adapter contract shared by functions, workflows and custom extension adapters. The server supplies these adapters explicitly. It is deliberately broader than a brain function: workflows coordinate functions rather than belonging to the five function types. The product taxonomy and supporting assets are defined in [Brain terminology](../../docs/concepts/terminology.md).

The API and the ledger call a saved definition a `spec`, its type a `primitive` and its recorded run an `execution`; the wire-format and storage details below use those words.

## Defining a runtime adapter

`definePrimitive` turns a definition into a `Primitive`. The server passes its primitives, in an explicit list, to `makeSpecOperations`.

This extension interface accepts custom adapters. Product categories use the shared `BrainFunctionKind` metadata: `functionKindOrder`, `functionCategoryLabels`, `functionResourceLabels` and `functionDescriptions`.

```ts
import { InvalidInput } from '@beonauto/operations';
import { definePrimitive } from '@beonauto/specs';
import { Effect, Predicate } from 'effect';

const parseGreeting = (source: string) =>
  source.includes('{name}')
    ? Effect.succeed({ template: source.trim() })
    : Effect.fail(
        new InvalidInput({
          detail: 'The greeting names no one',
          issues: [{ detail: 'Line 1: expected {name} where the name goes', pointer: '' }],
        }),
      );

export const greeting = definePrimitive({
  name: 'greeting',
  title: 'Greeting',
  description: [
    'Greets someone by name.',
    'A spec document of greeting is one line of text with {name} where the name goes,',
    'for example "Good morning, {name}!". The input is an object with a string name.',
  ].join(' '),
  mediaType: 'text/plain',
  parse: parseGreeting,
  summarize: ({ template }) => ({
    description: `Answers with "${template}"`,
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    outputSchema: { type: 'string' },
  }),
  execute: ({ template }, input) =>
    Predicate.hasProperty(input, 'name') && Predicate.isString(input.name)
      ? Effect.succeed({ output: template.replace('{name}', input.name), record: { template } })
      : Effect.fail(
          new InvalidInput({
            detail: 'The input names no one',
            issues: [{ detail: 'Expected a string', pointer: '/name' }],
          }),
        ),
});
```

A primitive has:

- `name`: 3 to 32 lowercase letters, digits and hyphens, starting with a letter. It names the primitive in routes, in the `primitive` field and in stream names, so it never changes.
- `title`, and a `description` written for an AI agent: what a spec of the primitive is and how its document is written. The operation descriptions repeat it, so the catalog documents every primitive without an operation to discover them.
- `mediaType`: the media type of its spec documents, such as `text/markdown`.
- `parse(source)`: turns the document into the primitive's own value. Parsing is validation: everything that can be checked without running is checked here. It fails with `InvalidInput`, whose issues each say in `detail` where in the document and what is wrong (line and problem). An issue's `pointer` addresses the document as a whole, so it is `''`; the operations answer it under `/source`.
- `summarize(parsed)`: what the operations show about a spec without knowing the primitive: an optional `description`, optional JSON Schemas of the input an execution takes (`inputSchema`) and the output it gives (`outputSchema`), and optional `warnings`: what `parse` found that does not stop the spec from being accepted but may not work everywhere, each a line of text that says where in the document (for inference: a schema some providers reject or do not enforce).
- `execute(parsed, input, execution)`: runs the spec. `input` is the caller's JSON value; `execution` carries its `id`, the `org`, the `brain`, the `caller` who started it (the identity the call was authorized for), the `spec` that runs, by `name` and `version`, and the `journal` through which it records the tool calls it makes (see [Tool calls](#tool-calls)). It answers with the `output`, a JSON value returned to the caller, and a `record`, a JSON object of what happened, stored with the execution (for inference: the rendered prompt, the model, token usage). It fails with `InvalidInput`, with pointers into the input (`/name` above; the operations answer them under `/input`); with `Unavailable` when something the primitive depends on cannot serve now and retrying may work; or with `Conflict` when the spec cannot run as written, which only running it can tell (for inference: a model the provider does not have), so the spec must be updated before it can run. A rejection may carry a `record`, a JSON object of what the primitive did before it (for inference: the tokens and the duration of a model call whose answer it could not use), which the run keeps on its `execution_rejected`, held to the same size limit as any record. A primitive that starts work which finishes after the call returns, such as a workflow, answers `{ finishesLater: true, record }` instead, the record saying what it started (for a workflow: its run reference); see [Runs that finish later](#executions-that-finish-later).

The compiler holds a primitive to its contract. The value `parse` gives is the value `summarize` and `execute` take. `parse` may fail only with `InvalidInput`, and `execute` only with `InvalidInput`, `Unavailable` or `Conflict` (the union `PrimitiveRejection`). Neither may ask for a service: whatever a primitive needs, such as a model client, it closes over when it is made. The output must be JSON and the record a JSON object.

TypeScript infers the parsed value from `parse` when `parse` is a function declared elsewhere, as above, or an arrow function. Written inline as `Effect.fnUntraced(function* (source: string) {...})`, `parse` does not give its type to `summarize` and `execute`; declare it as a constant first.

`parse` runs on every create, update and execution, and its parsed value is not kept, so it must give the same answer for the same document and be quick. A defect in `execute`, or an output that is not JSON, fails the execution.

A call cancelled while `execute` runs, because its client went away or the server is stopping, stops `execute` and records the execution `failed`. A retry with its id can run it again only if no recorded tool call blocks another attempt; see [Run ids and retries](#execution-ids-and-retries). A primitive that defines `whenCancelled: 'finish'` is not stopped: the call waits for `execute` to end and records its answer. Recording the start and the end of an execution is never cut short. An abrupt process crash can still leave a run `started` when it prevents the ending from being recorded.

## The operations

`makeSpecOperations(primitives, presenters?)` returns the ten operations for a catalog. All are brain operations, so their routes are relative to the brain. `defineCreateSpec`, `defineListSpecs`, `defineGetSpec`, `defineUpdateSpec`, `defineRetireSpec`, `defineExecuteSpec` and `defineListExecutions` make one of them each for a list of primitives, `getExecution` is another, `defineGetExecutionHistory(presenters)` another, and `defineGetBrainAnalytics` the last, for a list of primitives too; `presenters` defaults to `makeSpecPresenters(primitives)` (see [Reading runs](#reading-executions)). The list must hold at least one primitive, and no two of the same name.

| Operation               | Kind    | Route                                    | Input                                                                                  | Answer                                                | Rejections of the handler                               |
| ----------------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `create_spec`           | command | `POST /specs/{primitive}`                | `primitive`, `name`, `source`                                                          | the spec, `201`                                       | `not_found`, `invalid_input`, `conflict`                |
| `list_specs`            | query   | `GET /specs/{primitive}`                 | `primitive`, `include_retired` (default `false`)                                       | `{ specs }`, sorted by name, no documents             | `not_found`                                             |
| `get_spec`              | query   | `GET /specs/{primitive}/{name}`          | `primitive`, `name`                                                                    | the spec, active or retired, with document            | `not_found`                                             |
| `update_spec`           | command | `PUT /specs/{primitive}/{name}`          | `primitive`, `name`, `source`                                                          | the spec at its new version                           | `not_found`, `invalid_input`, `conflict`                |
| `retire_spec`           | command | `POST /specs/{primitive}/{name}/retire`  | `primitive`, `name`                                                                    | the spec                                              | `not_found`, `conflict`                                 |
| `execute_spec`          | command | `POST /specs/{primitive}/{name}/execute` | `primitive`, `name`, `input` (any JSON, default `{}`), `execution_id` (optional UUID)  | the execution                                         | `not_found`, `conflict`, `invalid_input`, `unavailable` |
| `get_execution`         | query   | `GET /executions/{execution_id}`         | `execution_id`                                                                         | the execution, with its record                        | `not_found`                                             |
| `list_executions`       | query   | `GET /executions`                        | `primitive`, `name`, `status`, `limit`, `cursor`, all optional                         | `{ executions, has_more, next_cursor }`, newest first | `invalid_input`                                         |
| `get_execution_history` | query   | `GET /executions/{execution_id}/history` | `execution_id`, `order` (default `asc`), `limit`, `cursor`                             | `{ events, has_more, next_cursor }`                   | `not_found`, `invalid_input`                            |
| `get_brain_analytics`   | query   | `GET /analytics`                         | `days` (7, 14 or 30, default 7), or `from` and `to`; `primitive`, `name`, all optional | the analytics of the brain                            | `invalid_input`                                         |

A spec carries `primitive`, `name`, `version`, `status` (`active` or `retired`), `media_type`, the `description`, `input_schema`, `output_schema` and `warnings` its primitive gives when it gives them, `created_at`, `created_by`, `updated_at`, `retired_at` on a retired spec, and its document as `source`. A listed spec is the same without `source`. Times are ISO 8601 UTC strings read from Effect's `Clock`. `DefinitionSchema`, `ListedDefinitionSchema`, `RunSchema` and `RunDetailSchema` are the schemas.

- `primitive` is the name of a primitive. The published JSON Schema of the field is a plain `{ "type": "string", "enum": [...], "description": ... }` of the known names. Decoding accepts any well-formed name, so a name the server does not know is `not_found` on every operation, and a malformed one `invalid_input`. Effect would publish the names under `allOf`, because it inlines no `enum` from a check, so each operation replaces that one property of its input's JSON Schema.
- `name` is 3 to 48 lowercase letters, digits and hyphens, starting with a letter: unique among the specs of the primitive in the brain, and never reused.
- `source` is at most 65536 bytes in UTF-8, checked at decoding. The JSON Schema says `maxLength: 65536`, which every such document meets.
- A document the primitive's `parse` rejects is `invalid_input` with the primitive's issues under `/source`, and nothing is stored.
- `create_spec` meets `conflict` when an active or a retired spec of the primitive holds the name.
- `update_spec` replaces the document. Every update that changes the document makes a new version, one more than the last; an update with the same document succeeds and records nothing. It meets `not_found` for a missing spec and `conflict` for a retired one.
- `retire_spec` is permanent: a retired spec can be read and listed, but not updated, executed or recreated. Retiring a retired spec succeeds and records nothing.
- Every command also meets `conflict` when the specs of the primitive, or the execution, changed while it decided.
- `execute_spec` runs the active latest version of the spec. It meets `not_found` for a missing spec, and `conflict` for a retired spec, a spec whose stored document its primitive no longer parses, or a spec its primitive finds cannot run as written.

The queries need `brain:read` and the commands `brain:write`. `execute_spec` is a command, because it records an execution, so a caller that may only read cannot execute a spec.

## Runs

An execution carries `execution_id`, `primitive`, `name`, `spec_version`, `status`, `output` when it succeeded, `rejection` (`reason`, `detail`, `issues` for `invalid_input`, and for `unavailable` the `kind` and `because` the primitive gave) when the primitive rejected it, `started_at`, `started_by`, and `finished_at` once it ended. `get_execution` also shows the `record` the primitive gave of what it did: of the run that succeeded, of what it did before it rejected the run when its rejection carries a `record`, such as the tokens a model call spent, or of the work it started that finishes later, kept when that work ends rejected or failed and dropped when a retry starts the execution again. `execute_spec` answers without the record, which can be large, since the output is what its caller asked for. Its status is `started` while it runs, while work it started finishes after the call returned, or when the process ended before it finished; then `succeeded`, `rejected` or `failed`.

`execute_spec` answers with the execution when it succeeded, and in status `started` when the primitive started work that finishes later. When the primitive rejects it with `invalid_input`, `unavailable` or `conflict`, the operation is rejected with that reason, detail and issues, and the rejection is recorded on the execution. When the primitive breaks down, the call fails with an incident, as any defect does, and the execution is recorded as `failed`; the defect itself goes only to the incident reporter. A rejected operation carries no execution id, so a caller that wants to read a rejected execution later gives it an id.

### Size limits

The ledger's cloud store holds at most 2 MB in a row, so an execution records bounded values. Sizes are counted on the value encoded as JSON, in UTF-8 bytes.

- The `input` may take at most 262144 bytes (256 KiB). A larger input is rejected with `invalid_input` at `/input` when the call is decoded, before anything is recorded.
- The `output` and the `record` of a primitive may take at most 1048576 bytes (1 MiB) together. A primitive that answers with more breaks down: the call fails with an incident and the execution is recorded as `failed`. The same holds for the record of work that finishes later, and for the output and record it is settled with.

JSON Schema has no keyword for the encoded size of any JSON value, so the published schemas state both limits in the descriptions of `input` and `output`, and in the description of `execute_spec`. `mostInputBytes` and `mostResultBytes` export them, so that a primitive can keep what it answers within them.

### Run ids and retries

A caller may name an execution with `execution_id`, a UUID; otherwise the operation makes one, a version 7 UUID. Ids are kept in lowercase. An id belongs to one execution: one primitive, one spec and one input. A call with an id of another spec or another input meets `conflict`.

An execution has a **final result** once it succeeded, or once the primitive rejected its input as invalid. A call with the id of an execution that has a final result runs nothing: it answers the same execution, or the same `invalid_input` rejection, even when the spec has changed or been retired since. A call with the id of an execution that waits for work it started to end runs nothing either: it answers the execution as it stands, `started`. A call with the id of an execution that has no final result and waits for nothing runs the active latest version of the spec again and records another attempt: when the execution started within its call and never finished because the process ended, when its call was cancelled, when the primitive was unavailable or found a conflict (a retry after the spec was updated runs the new version), and when it failed.

An execution that called tools is the exception, because a tool may have changed something: once its stream holds a tool call, a call with its id that would run it again is rejected with `conflict`, kind `tools_called`, and runs nothing, whether the execution failed, was rejected as `unavailable` or with a `conflict`, or stays `started` because the process ended; it is never recorded as finished for it, since that could mark a duplicate still running elsewhere as failed. So is a call with the id of a started execution whose spec calls tools before any call is recorded: the first attempt may still be in progress, about to call a tool, or may have stopped without recording how it ended, and running a second would let two runs call tools. The primitive tells from the parsed spec whether it calls tools (`callsTools`), and the start of a run records it on its `execution_started` as `calls_tools: true`; a start is refused while the attempt started last is running and either recorded that it calls tools or the spec calls them now, so a spec that loses its tools while a run of it is going cannot let a second run start under its id. A new run needs another id. An execution that called tools and succeeded, or whose input was rejected, is answered again as any other.

So execution is **at least once**: the primitive may run more than once for one id, when a call is retried after the server stopped during a run, after `unavailable`, a `conflict` the primitive found, or a failure, or when two calls with the same id run at the same moment and the ledger lets both start. Each id has **exactly one recorded result**: the first final result recorded for it is never replaced, and every later call with the id answers it. A primitive that acts on the world, such as one that sends a message, must tolerate running twice for the same `execution.id`.

### Runs that finish later

A primitive may state `longestExecutionMs`, the longest one execution may legitimately take (for inference: the deadline of a model call for the most output tokens, 60 seconds and 25 ms a token, 1660000 ms for 64000); a workflow gives a nested execution that long, and a minute more, before its call fails. A primitive that states none is given 10 minutes. A primitive states `reachesOutside: true` when its executions call systems outside the server, as inference calls model providers; `execute_spec` then says it reaches outside, which its MCP tool shows as `openWorldHint`. A primitive states `mayChangeOutside: true` when those calls may change something there, as inference does once an MCP server is configured; `execute_spec` then says so, which its MCP tool shows as `destructiveHint`, so that an assistant asks before running a spec.

A primitive such as a workflow starts work that completes long after the call returns. Its `execute` answers `{ finishesLater: true, record }`, the record saying what it started. Such a primitive defines `whenCancelled: 'finish'`, so that a call cancelled while `execute` runs, because its client went away or the server is stopping, waits for `execute` to end and records what it started; `execute` must then end within a bounded time (a workflow's start gives up after 10 seconds). The execution is recorded as deferred and stays `started`: `execute_spec` answers with it in status `started` (still `200`), `get_execution` shows it `started` until it is settled, and a retry with its id answers it as it stands without starting the work again.

Whoever started the work settles the execution when the work ends, with `executionSettler`:

```ts
import { executionSettler, type SettleExecution } from '@beonauto/specs';

const settle: SettleExecution = executionSettler(ledger);

settle(execution, { status: 'succeeded', output, record });
settle(execution, { status: 'rejected', reason: 'unavailable', detail: 'The worker pool is gone' });
settle(execution, { status: 'failed' });
```

`executionSettler(ledger)` takes the unbound `Ledger` and gives a `SettleExecution`. It is not an operation and no transport reaches it: the server's composition root, the only code that holds the `Ledger`, makes it and hands it to the primitives that finish later when it makes them. Each call to `settle` names the execution by `org`, `brain` and `id` (the `RunContext` a primitive got carries all three), and binds the ledger to that org and brain alone, through `streamPrefixOfBrain`, after checking the ids are well formed, so it reaches nothing but that brain's `executions/{id}` stream. It records through the same stream and decider as `execute_spec`:

- a deferred execution that has not been settled is settled: `succeeded` with its output and record, `rejected` with `invalid_input` (no issues) or `unavailable`, or `failed`;
- settling it again with the same result records nothing and answers the execution;
- settling an execution that already ended with another result, or one that runs within its call, is `conflict`;
- settling one the brain does not have, or an ill-formed address, is `not_found`;
- an output and record over the size limit, or not JSON, settle it as `failed`, and the call dies with the defect.

The settlement is recorded as done by the caller who started the execution. A deferred execution settled as `unavailable` or `failed` has no final result, so a call with its id runs it again, as any other.

## Reading runs

`list_executions` lists the executions of a brain, newest first by the position of the first message of each execution stream, so an execution started again with the same id keeps the place of its first start, and two started in the same millisecond keep a fixed order. It reads the ledger's selection of the first and the latest message of every execution stream (`BrainReader.readRecorded({ kind: 'executions' }, page)`) and folds the two with the execution decider's `evolve`, so a `ListedRun` is the run as `get_execution` shows it, without its `output`, its `record` and the `detail` and `issues` of a rejection: `execution_id`, `primitive`, `name`, `spec_version`, `status`, `started_at`, `started_by`, `finished_at`, and a `rejection` of `reason`, with the `kind` and `because` of `unavailable`. When the latest message is a start, the execution shows that start; when the execution was started again and has since finished, it shows its first start, since the selection holds no other, while `get_execution` shows the latest.

- `status` is answered by the ledger from the stored type of the latest message: `storedTypesByStatus` in `src/reading/execution-status.ts` is the one place that maps a status to the stored types it stands for, `started` to `execution_started` and `execution_deferred`.
- `primitive` and `name` are applied after decoding the first message of each execution the page looked at, so a filter that matches rarely answers short or empty pages with `next_cursor`. A primitive the server does not offer lists the executions recorded under it, if any.
- `limit` is 1 to 100, 20 when left out. A page also ends at 4 MiB of stored data and, with `status`, after looking at 1,000 executions. Every page carries `has_more` and `next_cursor`, null when nothing remains, and a cursor that does not decode, or that another brain gave, is `invalid_input` at `/cursor`.

`get_execution_history` reads the two streams of one execution through the ledger's run selection, `executions/{execution_id}` and, for a workflow's run log, `runs/{execution_id}`, one page at a time, oldest first unless `order` is `desc`. Each record is shown through the presenter of its stream kind and hidden when its kind has none; the server gives the presenter of the run log, `runPresenter` of `@beonauto/orchestration`, so a workflow's history shows a `workflow_input_applied` event for each input its run took. Within a page the events are merged by their own time, then by stream, then by their order in the stream; across pages they follow the ledger's order. An execution the brain does not have is `not_found`. A page that holds a record proves the execution exists; an empty page decides it as `get_execution` does, by loading the execution's stream through `BrainReader`, and never by a read of the ledger's order, which on PostgreSQL stays behind the oldest write still open in the ledger's database when it reads oldest first. So the first page of an execution whose records are still behind that horizon is empty, with `has_more` false and `next_cursor` null, and a reader reads it again.

Each event is a `PublicEvent`, `{ id, at, type, summary, data }`: `id` is the record's cursor, `at` the event's own time, `type` a public name, `summary` plain words with no ids, and `data` at most 4 KiB as JSON. `makeSpecPresenters(primitives)` gives the presenters of the two stream kinds this package owns, which the server also passes to the feed of the brain, `list_brain_events` of `@beonauto/brains`:

| Stream kind  | Stored type and public name    | `data`                                                                                                                                                                                        |
| ------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executions` | `execution_started`            | `execution_id`, `by`, `primitive`, `name`, `spec_version`, `input_bytes`                                                                                                                      |
| `executions` | `execution_deferred`           | `execution_id`, `by`, `record_bytes`                                                                                                                                                          |
| `executions` | `execution_succeeded`          | `execution_id`, `by`, `output_bytes`, `record_bytes`                                                                                                                                          |
| `executions` | `execution_rejected`           | `execution_id`, `by`, `reason`, `detail` cut at 1024 bytes, `kind` and `because` when given, and for `invalid_input` `issue_count` and the first five `issues`                                |
| `executions` | `execution_failed`             | `execution_id`, `by`                                                                                                                                                                          |
| `executions` | `tool_call_started`            | `execution_id`, `by`, `number`, `call_id`, `server`, `tool`, `arguments_bytes`, `arguments_sha256`, and `arguments_json` cut at 2048 bytes when recorded                                      |
| `executions` | `tool_call_answered`           | `execution_id`, `by`, `number`, `outcome`, `result_bytes`, `result_sha256`, `duration_ms`, `jsonrpc_id`, `server_request_id` when recorded, and `result_json` cut at 2048 bytes when recorded |
| `specs`      | `spec_created`, `spec_updated` | `primitive`, `name`, `by`, `version`, `source_bytes`, the first 300 characters of `description`, `input_schema_bytes`, `output_schema_bytes`, `warning_count`                                 |
| `specs`      | `spec_retired`                 | `primitive`, `name`, `by`                                                                                                                                                                     |

Sizes are of the value as JSON in UTF-8, the document's of its own text. A cut is made at a code point, measured as JSON so that escapes count, and `by` is cut at 256 bytes; an issue's `detail` at 256 bytes and its `pointer` at 128; a tool call's `call_id`, `server`, `tool` and `server_request_id` at 256 bytes, its digests and a `jsonrpc_id` that is text at 128. The latest message of a running execution may be a tool event, which `list_executions` shows as `started`. A test over the event schemas of both deciders holds every stored type to a decision of its presenter, and the largest record each type can hold to 4 KiB of `data`.

## Storage

The specs of one primitive in a brain are one stream, named `specs/{primitive}` relative to the brain. Its events carry a `type`, the spec `name`, who recorded them (`by`) and when (`at`):

- `spec_created`, with `version` 1 and the `content`: the `source` and the `description`, `input_schema`, `output_schema` and `warnings` its primitive gave
- `spec_updated`, with the new `version` and the whole new `content`
- `spec_retired`

Each execution is a stream of its own, named `executions/{execution_id}` relative to the brain. Its events carry a `type`, who and when:

- `execution_started`, with the `primitive`, the spec `name`, the `spec_version` and the `input`, and `calls_tools: true` when its spec calls tools; a retry records it again
- `execution_deferred`, with the `record` of the work that finishes later; an execution that started and never finished has no such event, which is how a retry tells the two apart
- `execution_succeeded`, with the `output` and the primitive's `record`
- `execution_rejected`, with the `rejection`, and the `record` its rejection carried, when it carried one
- `execution_failed`
- `tool_call_started` and `tool_call_answered`, for each tool call it makes, described under [Tool calls](#tool-calls)

There is no read model of the specs or of a run: each call folds the streams it needs. The outcomes of runs, which `get_brain_analytics` reads, are a table the ledger keeps from these events (see [Analytics](#analytics)). Pure deciders hold the rules: one per primitive's specs, and one for executions. The handlers pass them who and when in each command.

## Analytics

`defineGetBrainAnalytics(primitives)` makes `get_brain_analytics`, `GET /analytics` relative to the brain, under `brain:read`. It reads the outcomes of the brain's runs over a window of days in UTC, through `BrainReader.readRunOutcomes` (see [`@beonauto/operations`](../operations/README.md#the-outcomes-of-runs)), one statement of the store:

- the window: `days`, 7, 14 or 30, the last days ending today, 7 when nothing is given; or `from` and `to`, both included, at most 366 days, with `to` not before `from` and not after today. A day must name the same day when read back, so `2026-02-30` is refused at `/from` by the input schema. `days` with `from` or `to` is `invalid_input` at `/days`, `from` without `to` at `/to` and `to` without `from` at `/from`, a window that ends before it starts or after today at `/to`, and one longer than 366 days at `/from`. An unknown `days` or parameter is refused as every input is.
- `primitive` and `name`, as `list_executions` takes them, keep the runs of that API type identifier and definition name.
- The answer: `days`; `runs`, with the `total`, `succeeded`, `failed` and `rejected`; `tokens`, the `input`, `output` and `cached` tokens; `duration_ms`, with `p50` and `p95`, or `null`; `by_day`, the same three for every day of the window, oldest first, a day without runs included; and `by_function`, each definition's `primitive`, `name` and `runs`, the most runs first, then by `primitive` and `name` in the order of their characters.
- A run counts on the day it first started, once it has ended; a run still `started` counts nowhere. Its duration runs from its latest start to its end, for a run that succeeded or failed, workflows included; a rejected run counts in `runs` and in `tokens`, never in `duration_ms`. A percentile is the nearest rank, the duration at place ⌈p × n⌉ of the durations in order; the operation adds the groups the ledger answers and takes the percentiles in code. Tokens sum what was recorded, 0 otherwise, and `cached` is the cache-read part of `input`.

`runOutcomeMapping` is the `RunOutcomeMapping` of the run events, which the server gives the ledger at composition. It reads `execution_started`, `execution_succeeded`, `execution_failed` and `execution_rejected`, and leaves the row as it is for anything it does not understand:

| Field                                          | From                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startedDay`, `startedAt`, `primitive`, `name` | the first `execution_started` of the run, its `at` and its UTC date; a finish without a start gives its own `at` and empty names                                                       |
| `lastStartedAt`                                | the `at` of the latest `execution_started`                                                                                                                                             |
| `status`                                       | `started` from every start, then `succeeded`, `failed` or `rejected` from the finish                                                                                                   |
| `durationMs`                                   | the finish's `at` less `lastStartedAt` for a run that succeeded or failed, never below 0; `null` for a rejected run, a run still started, or a finish without a start                  |
| the tokens                                     | `record.usage.input.total`, `record.usage.output.total` and `record.usage.input.cache_read` of the finish, each a whole number of at least 0, else `null`; `null` again at every start |

## Tool calls

A primitive whose executions call tools, as inference does through MCP servers ([decision 0003](../../docs/decisions/0003-mcp-servers.md)), records each call on the execution's own stream as it happens, through `execution.journal.record(fact)`, which answers whether the fact was recorded:

- `tool_call_started`, before the call is sent: its `number` within the run, the `call_id` the model gave it, the `server` and `tool`, the size and SHA-256 digest of its arguments as sent (`arguments_bytes`, `arguments_sha256`), and `arguments_json`, cut to 4 KiB, when the server's operator records content;
- `tool_call_answered`: the `number`, the `outcome` (`result`, `tool_error`, `server_failure`, `timed_out` or `cancelled`), the size and digest of the result (`result_bytes`, `result_sha256`, null when there is none), `duration_ms`, the `jsonrpc_id` sent, `server_request_id` when the server's entry names where it carries one, and `result_json`, cut to 4 KiB, when content is recorded.

The journal is built with the rest of the context in one place, so executions started directly and by a workflow record alike. It holds a permit per execution, so the calls of one step, made at once, append one at a time, as an append is retried only three times on a version conflict. The decider refuses a tool event once the execution has finished, however it ended: a call still in flight then keeps a start and no answer, which reads as an outcome unknown. The state counts the calls, which is what keeps an execution that called tools from running again under its id (see [Run ids and retries](#execution-ids-and-retries)).

## Testing

`@beonauto/specs/testing` exports `echo`, a small real primitive for the tests of this and other packages. Its spec document is a JSON object with a string `greeting`, an optional string `description` and optional `warnings`, a list of strings its summary gives back; an execution takes a JSON object and answers `{ greeting, input }`.

## Source

`src/index.ts` is the only entry point, and `src/testing/index.ts` the entry point of the test support. `src/primitive` holds the definition of a primitive and the list of known primitives. `src/registry` holds the specs of a primitive in a brain: a spec, the events and commands of its stream, and the decider and its rules. `src/execution` holds an execution: its events, commands, state, decider and rules, its size limits, and `executionSettler`. `src/operations` holds the seven operations that change and read specs and executions, and how they load and record them. `src/reading` holds `list_executions` and `get_execution_history`, `src/analytics` `get_brain_analytics` and `runOutcomeMapping`, and `src/presenting` the presenters of the two stream kinds. `src/tool-calls` holds the journal of an execution's tool calls. `src/testing` holds what the tests share. `operations` depends on the others, `reading` on `presenting`, on `analytics` and on the fields of `operations`, `analytics` on the fields of `operations` and the words of `plain-language`, and `registry` and `execution` on nothing in this package.
