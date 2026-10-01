# @beonauto/operations

The application layer of auto-brain: where operations are defined and run.

An **operation** is a **query**, which reads, or a **command**, which changes something. Its **scope** is `org` or `brain`. Transports such as HTTP and MCP serve the operations of a catalog; this package knows nothing about them.

## Defining an operation

```ts
import { NotFound, OrgReader, defineQuery, type Decider } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';

const LabelSchema = Schema.Struct({ name: Schema.String, text: Schema.String });

type Label = typeof LabelSchema.Type;

export const labels: Decider<readonly Label[], Label, Label> = {
  initialState: [],
  evolve: (written, label) => [...written, label],
  decide: (label) => Result.succeed([label]),
  eventSchema: LabelSchema,
};

export const getLabel = defineQuery('org', {
  name: 'get_label',
  title: 'Get label',
  description: 'Reads one label of the org.',
  route: { method: 'GET', path: '/labels/{name}' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  outputSchema: LabelSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ name }) {
    const { state } = yield* (yield* OrgReader).load('labels', labels);
    const label = state.find((written) => written.name === name);
    if (label === undefined) {
      return yield* new NotFound({ detail: `There is no label ${name}` });
    }
    return label;
  }),
});
```

This example is `src/testing/readme-example.ts`; `src/readme.test.ts` fails if the two differ, and runs it.

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

When an operation is defined, it checks again what the compiler cannot see, on the encoded form of its schemas, the form that travels:

- the name matches `^[a-z][a-z0-9_]{0,63}$` and the route path is well formed;
- the input and the output are objects that declare their fields, or unions of such objects, with no empty struct at any depth (an input with no fields is `Schema.Record(Schema.String, Schema.Never)`);
- no input field is named `org`, nor `brain` at brain scope;
- each route parameter is a required string field of every member of the input;
- a field the handler calls `brain` also travels as `brain`.

At run time a handler that fails with a reason it did not declare is a fault, not a refusal.

`getLabel.registration` is what a catalog stores: the route, the kind, the success status, the reasons, whether the operation addresses a brain, and JSON Schema for the input and output with their definitions kept apart. Its `run` decodes an input, runs the handler and encodes the output; only the dispatcher calls it, because it checks nothing about the caller.

`getLabel.call(input)` runs the handler in process with typed input and output, checking both against their schemas. This is how one operation calls another. The call runs with the authority of the calling operation: it does not check the permission of the operation it calls, nor run the pipeline steps.

`makeCatalog([getLabel, ...])` refuses a name used twice, and two operations with the same method and route once parameter names are ignored, where an org route is under `/orgs/{org}` and a brain route under `/orgs/{org}/brains/{brain}`. It lists the operations of each scope.

### The brain of an org operation

An org operation addresses at most one brain, and names it `brain`. When its input declares a `brain` field, the dispatcher checks that the caller may reach that brain, wherever the field arrives from: path, query or body. A second field that names a brain is not checked and must not be used. Whether that brain exists, and whether its id is well formed, is the handler's business at org scope, because the org's brain records are the handler's.

`mayReachBrain(access, brain)` is the reach rule the dispatcher applies, for a handler that lists only the brains its caller may reach.

## The dispatcher

`makeDispatcher(steps)` returns `inOrg` and `inBrain`, which run one call through this pipeline:

1. The caller's org must equal the org of the call, or the call is `forbidden`.
2. The caller must hold the permission of the operation's kind and scope: `org:read`, `org:write`, `brain:read` or `brain:write`.
3. At brain scope, and for an org operation that addresses a brain, the caller must be allowed to reach that brain.
4. The org id must be well formed and, at brain scope, the brain id must be well formed and the brain must exist, or the call is `not_found`. An ill-formed id is never echoed back.
5. The pipeline steps run in order.
6. The input is decoded, refusing unknown keys and pointing at every problem, up to 100 of them. Input nested too deeply to decode is refused the same way.
7. The handler runs.
8. The output is checked against the output schema and encoded as JSON.

A caller of one org gets the same `forbidden` for an existing and a missing brain of another org. A caller's identity can be decoded with `CallerIdentitySchema`.

The outcome is `done`, `refused` or `faulted`. Any defect becomes `faulted` with an incident id. The `IncidentReporter` receives the id, the original defect and the call: the operation, the org, the brain when there is one, and the caller's id, never the input. It has two seconds; when it fails or takes longer, the incident id is logged with `Effect.logError`, and the outcome stays `faulted`.

A transport runs a call with `settle(call, signal)` and always gets a `Settled` value: the outcome, or `stopped` when the signal aborts the call or the call interrupts itself. Any other failure settles as `faulted` with a reported incident.

The dispatcher needs a `Ledger`, a `BrainDirectory` and an `IncidentReporter`. Handlers can see none of them, neither in their types nor at run time. A handler can read any other service present in the runtime's context, so the runtime must expose only these three at its top level, and an adapter must keep its own dependencies, such as a database client, inside its layer.

## The ledger ports

A `Decider` holds the event-sourced rules of a stream: its initial state, how an event evolves the state, how a command decides on new events or a refusal, and the schema of its events.

`Ledger` is the unbound port. It addresses streams by full name, loads a stream's state and version by folding its events, and runs a command through a decider, refusing with `conflict` when the stream moved. The version of a stream is the number of events in it, 0 for a stream that does not exist. A conflict's detail must not name the stream. Its implementation lives with the ledger.

For each call the dispatcher binds the ledger to the call's address. `OrgReader` and `OrgWriter` prefix a stream name with `org/{org}/`; `BrainReader` and `BrainWriter` with `brain/{org}/{brain}/`. A handler names its streams relative to its org or brain: one or more segments of letters, digits, `_` and `-`, each at most 64 characters, joined by `/`, at most 256 characters in all. Any other name is a fault. So a handler has no way to name another org's or brain's streams. Stream names are case-sensitive, and a ledger implementation must treat them as opaque strings.

`streamPrefixOfOrg({ org })` returns the prefix of an org's streams, so code that holds the unbound `Ledger`, such as a `BrainDirectory`, reads the same stream a handler names relative to its org.

## Testing

`@beonauto/operations/testing` exports an in-memory `Ledger`, `BrainDirectory` and `IncidentReporter` for the tests of packages that define or serve operations.
