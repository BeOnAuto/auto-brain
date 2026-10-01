# @beonauto/operations

The application layer of auto-brain: where operations are defined and run.

An **operation** is a **query**, which reads, or a **command**, which changes something. Its **scope** is `org` or `brain`. Transports such as HTTP and MCP serve the operations of a catalog; this package knows nothing about them.

## Defining an operation

```ts
import { Effect, Schema } from 'effect';
import { BrainReader, NotFound, defineQuery } from '@beonauto/operations';

export const getSpec = defineQuery('brain', {
  name: 'get_spec',
  title: 'Get spec',
  description: 'Reads one spec of the brain.',
  route: { method: 'GET', path: '/{primitive}/{name}' },
  inputSchema: Schema.Struct({ primitive: Schema.String, name: Schema.String }),
  outputSchema: Spec,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ primitive, name }) {
    const { state } = yield* (yield* BrainReader).load(`specs/${primitive}`, specs);
    const spec = state.find((candidate) => candidate.name === name);
    if (spec === undefined) {
      return yield* new NotFound({ detail: `There is no ${primitive} spec ${name}` });
    }
    return spec;
  }),
});
```

Here `Spec` is the schema of a spec and `specs` the decider of a spec stream.

The compiler holds a definition to these rules:

- A query's route uses `GET` and a command's `POST` or `PUT`. Only a command may answer `201` instead of `200`.
- The route path is relative to the scope's prefix. Each `{parameter}` must be a string field of the input.
- The input may not have an `org` field, nor a `brain` field at brain scope.
- The handler may fail only with the refusals it declares in `reasons`: `NotFound`, `Conflict` or `Unavailable`.
- The handler may ask only for the services of its scope and kind:

| Scope   | Query                                 | Command also gets |
| ------- | ------------------------------------- | ----------------- |
| `org`   | `Caller`, `OrgScope`, `OrgReader`     | `OrgWriter`       |
| `brain` | `Caller`, `BrainScope`, `BrainReader` | `BrainWriter`     |

When it is defined, the operation also checks that its name matches `^[a-z][a-z0-9_]{0,63}$`, that its route path is well formed, and that its input and output declare their fields. An input with no fields is `Schema.Record(Schema.String, Schema.Never)`.

`getSpec.registration` is what a catalog stores: the route, the kind, the success status, the reasons, and JSON Schema for the input and output with their definitions kept apart. `getSpec.call(input)` runs the handler in process with typed input and output, which is how one operation calls another.

`makeCatalog([getSpec, ...])` refuses a name used twice and lists the operations of each scope.

## The dispatcher

`makeDispatcher(steps)` returns `inOrg` and `inBrain`, which run one call through this pipeline:

1. The caller's org must equal the org of the call, or the call is `forbidden`.
2. The caller must hold the permission of the operation's kind and scope: `org:read`, `org:write`, `brain:read` or `brain:write`.
3. At brain scope, and for an org operation whose route names a `{brain}`, the caller must be allowed to reach that brain.
4. The org id must be well formed and, at brain scope, the brain must exist, or the call is `not_found`.
5. The pipeline steps run in order.
6. The input is decoded, refusing unknown keys and pointing at every problem.
7. The handler runs.
8. The output is checked against the output schema and encoded as JSON.

A caller of one org gets the same `forbidden` for an existing and a missing brain of another org.

The outcome is `done`, `refused` or `faulted`. Any defect becomes `faulted` with an incident id, and the original goes to the `IncidentReporter` only. `settle(exit)` turns the exit of a call into its outcome, or `stopped` when the call was interrupted.

The dispatcher needs a `Ledger`, a `BrainDirectory` and an `IncidentReporter`. Handlers can see none of them, neither in their types nor at run time.

## The ledger ports

A `Decider` holds the event-sourced rules of a stream: its initial state, how an event evolves the state, how a command decides on new events or a refusal, and the schema of its events.

`Ledger` is the unbound port. It addresses streams by full name, loads a stream's state and version by folding its events, and runs a command through a decider, refusing with `conflict` when the stream moved. Its implementation lives with the ledger.

For each call the dispatcher binds the ledger to the call's address. `OrgReader` and `OrgWriter` prefix a stream name with `org/{org}/`; `BrainReader` and `BrainWriter` with `brain/{org}/{brain}/`. A handler names its streams relative to its org or brain, so it has no way to name another's. A ledger implementation must treat stream names as opaque strings.
