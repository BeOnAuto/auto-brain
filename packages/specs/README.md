# @beonauto/specs

The spec operations of auto-brain: create, list, read, update, retire and execute the specs of every primitive in a brain, and read the executions. They are defined on the application layer, [`@beonauto/operations`](../operations).

## Primitives, specs and executions

A **primitive** is a kind of capability a brain has, such as inference or orchestration. Every brain has the primitives the server is given.

A **spec** is one named, versioned definition of something a primitive can execute, written as a text document in the primitive's own format: for inference, Markdown with YAML front matter; for orchestration, a YAML workflow. A spec belongs to one primitive in one brain.

An **execution** is one run of a spec with an input, recorded with how it ended.

## Defining a primitive

`definePrimitive` turns a definition into a `Primitive`. The server passes its primitives, in an explicit list, to `makeSpecOperations`.

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
- `summarize(parsed)`: what the operations show about a spec without knowing the primitive: an optional `description`, and optional JSON Schemas of the input an execution takes (`inputSchema`) and the output it gives (`outputSchema`).
- `execute(parsed, input, execution)`: runs the spec. `input` is the caller's JSON value; `execution` carries its `id`, the `org`, the `brain`, and the `spec` that runs, by `name` and `version`. It answers with the `output`, a JSON value returned to the caller, and a `record`, a JSON object of what happened, stored with the execution (for inference: the rendered prompt, the model, token usage). It fails with `InvalidInput`, with pointers into the input (`/name` above; the operations answer them under `/input`), or with `Unavailable` when something the primitive depends on cannot serve now and retrying may work.

The compiler holds a primitive to its contract. The value `parse` gives is the value `summarize` and `execute` take. `parse` may fail only with `InvalidInput`, and `execute` only with `InvalidInput` or `Unavailable`. Neither may ask for a service: whatever a primitive needs, such as a model client, it closes over when it is made. The output must be JSON and the record a JSON object.

TypeScript infers the parsed value from `parse` when `parse` is a function declared elsewhere, as above, or an arrow function. Written inline as `Effect.fnUntraced(function* (source: string) {...})`, `parse` does not give its type to `summarize` and `execute`; declare it as a constant first.

`parse` runs on every create, update and execution, and its parsed value is not kept, so it must give the same answer for the same document and be quick. A defect in `execute`, or an output that is not JSON, fails the execution.

## The operations

`makeSpecOperations(primitives)` returns the seven operations for a catalog. All are brain operations, so their routes are relative to the brain. `defineCreateSpec`, `defineListSpecs`, `defineGetSpec`, `defineUpdateSpec`, `defineRetireSpec` and `defineExecuteSpec` make one of them each for a list of primitives, and `getExecution` is the seventh. The list must hold at least one primitive, and no two of the same name.

| Operation       | Kind    | Route                                    | Input                                                                                 | Answer                                     | Rejections of the handler                               |
| --------------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `create_spec`   | command | `POST /specs/{primitive}`                | `primitive`, `name`, `source`                                                         | the spec, `201`                            | `not_found`, `invalid_input`, `conflict`                |
| `list_specs`    | query   | `GET /specs/{primitive}`                 | `primitive`, `include_retired` (default `false`)                                      | `{ specs }`, sorted by name, no documents  | `not_found`                                             |
| `get_spec`      | query   | `GET /specs/{primitive}/{name}`          | `primitive`, `name`                                                                   | the spec, active or retired, with document | `not_found`                                             |
| `update_spec`   | command | `PUT /specs/{primitive}/{name}`          | `primitive`, `name`, `source`                                                         | the spec at its new version                | `not_found`, `invalid_input`, `conflict`                |
| `retire_spec`   | command | `POST /specs/{primitive}/{name}/retire`  | `primitive`, `name`                                                                   | the spec                                   | `not_found`, `conflict`                                 |
| `execute_spec`  | command | `POST /specs/{primitive}/{name}/execute` | `primitive`, `name`, `input` (any JSON, default `{}`), `execution_id` (optional UUID) | the execution                              | `not_found`, `conflict`, `invalid_input`, `unavailable` |
| `get_execution` | query   | `GET /executions/{execution_id}`         | `execution_id`                                                                        | the execution                              | `not_found`                                             |

A spec carries `primitive`, `name`, `version`, `status` (`active` or `retired`), `media_type`, the `description`, `input_schema` and `output_schema` its primitive gives when it gives them, `created_at`, `created_by`, `updated_at`, `retired_at` on a retired spec, and its document as `source`. A listed spec is the same without `source`. Times are ISO 8601 UTC strings read from Effect's `Clock`. `SpecSchema`, `ListedSpecSchema` and `ExecutionSchema` are the schemas.

- `primitive` is the name of a primitive. The JSON Schema of the field lists the known names; a well-formed name the server does not know is `not_found` on every operation.
- `name` is 3 to 48 lowercase letters, digits and hyphens, starting with a letter: unique among the specs of the primitive in the brain, and never reused.
- `source` is at most 65536 bytes in UTF-8, checked at decoding. The JSON Schema says `maxLength: 65536`, which every such document meets.
- A document the primitive's `parse` rejects is `invalid_input` with the primitive's issues under `/source`, and nothing is stored.
- `create_spec` meets `conflict` when an active or a retired spec of the primitive holds the name.
- `update_spec` replaces the document. Every update that changes the document makes a new version, one more than the last; an update with the same document succeeds and records nothing. It meets `not_found` for a missing spec and `conflict` for a retired one.
- `retire_spec` is permanent: a retired spec can be read and listed, but not updated, executed or recreated. Retiring a retired spec succeeds and records nothing.
- Every command also meets `conflict` when the specs of the primitive, or the execution, changed while it decided.
- `execute_spec` runs the active latest version of the spec. It meets `not_found` for a missing spec, and `conflict` for a retired spec or a spec whose stored document its primitive no longer parses.

The queries need `brain:read` and the commands `brain:write`. `execute_spec` is a command, because it records an execution, so a caller that may only read cannot execute a spec.

## Executions

An execution carries `execution_id`, `primitive`, `name`, `spec_version`, `status`, `output` when it succeeded, `rejection` (`reason`, `detail`, and `issues` for `invalid_input`) when the primitive rejected it, `started_at`, `started_by`, and `finished_at` once it ended. Its status is `started` while it runs, or when the server stopped before it finished, then `succeeded`, `rejected` or `failed`.

`execute_spec` answers with the execution when it succeeded. When the primitive rejects it with `invalid_input` or `unavailable`, the operation is rejected with that reason, detail and issues, and the rejection is recorded on the execution. When the primitive breaks down, the call fails with an incident, as any defect does, and the execution is recorded as `failed`; the defect itself goes only to the incident reporter. A rejected operation carries no execution id, so a caller that wants to read a rejected execution later gives it an id.

### Execution ids and retries

A caller may name an execution with `execution_id`, a UUID; otherwise the operation makes one, a version 7 UUID. Ids are kept in lowercase. An id belongs to one execution: one primitive, one spec and one input. A call with an id of another spec or another input meets `conflict`.

An execution has a **final result** once it succeeded, or once the primitive rejected its input as invalid. A call with the id of an execution that has a final result runs nothing: it answers the same execution, or the same `invalid_input` rejection, even when the spec has changed or been retired since. A call with the id of an execution that has no final result runs the active latest version of the spec again and records another attempt: when the execution started and never finished, when the primitive was unavailable, and when it failed.

So execution is **at least once**: the primitive may run more than once for one id, when a call is retried after the server stopped during a run, after `unavailable` or a failure, or when two calls with the same id run at the same moment and the ledger lets both start. Each id has **exactly one recorded result**: the first final result recorded for it is never replaced, and every later call with the id answers it. A primitive that acts on the world, such as one that sends a message, must tolerate running twice for the same `execution.id`.

## Storage

The specs of one primitive in a brain are one stream, named `specs/{primitive}` relative to the brain. Its events carry a `type`, the spec `name`, who recorded them (`by`) and when (`at`):

- `spec_created`, with `version` 1 and the `content`: the `source` and the `description`, `input_schema` and `output_schema` its primitive gave
- `spec_updated`, with the new `version` and the whole new `content`
- `spec_retired`

Each execution is a stream of its own, named `executions/{execution_id}` relative to the brain. Its events carry a `type`, who and when:

- `execution_started`, with the `primitive`, the spec `name`, the `spec_version` and the `input`; a retry records it again
- `execution_succeeded`, with the `output` and the primitive's `record`
- `execution_rejected`, with the `rejection`
- `execution_failed`

There is no read model: each call folds the streams it needs. Pure deciders hold the rules: one per primitive's specs, and one for executions. The handlers pass them who and when in each command.

## Testing

`@beonauto/specs/testing` exports `echo`, a small real primitive for the tests of this and other packages. Its spec document is a JSON object with a string `greeting` and an optional string `description`; an execution takes a JSON object and answers `{ greeting, input }`.

## Source

`src/index.ts` is the only entry point, and `src/testing/index.ts` the entry point of the test support. `src/primitive` holds the definition of a primitive and the list of known primitives. `src/registry` holds the specs of a primitive in a brain: a spec, the events and commands of its stream, and the decider and its rules. `src/execution` holds an execution: its events, commands, state, decider and rules. `src/operations` holds the seven operations and how they load and record specs and executions. `src/testing` holds what the tests share. `operations` depends on the others, and `registry` and `execution` on nothing in this package.
