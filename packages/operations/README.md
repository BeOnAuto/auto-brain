# @beonauto/operations

The application layer of auto-brain: where operations are defined and run.

An **operation** is a **query**, which reads, or a **command**, which changes something. Its **scope** is `org` or `brain`. Transports such as HTTP and MCP serve the operations of a catalog; this package knows nothing about them.

## Defining an operation

```ts
import { NotFound, OrgReader, defineQuery, type Decider } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';

const LabelSchema = Schema.Struct({ name: Schema.String, text: Schema.String });

type Label = typeof LabelSchema.Type;

const LabelWrittenSchema = Schema.Struct({ type: Schema.Literal('label_written'), label: LabelSchema });

type LabelWritten = typeof LabelWrittenSchema.Type;

export const labels: Decider<readonly Label[], Label, LabelWritten> = {
  initialState: [],
  evolve: (written, { label }) => [...written, label],
  decide: (label) => Result.succeed([{ type: 'label_written', label }]),
  eventSchema: LabelWrittenSchema,
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

The compiler holds a definition to these rules:

- A query's route uses `GET` and a command's `POST` or `PUT`. Only a command may answer `201` instead of `200`.
- The route path is relative to the scope's prefix. Each `{parameter}` must be a string field of the input.
- The input may not have an `org` field, nor a `brain` field at brain scope.
- The handler may fail only with the rejections it declares in `reasons`: `NotFound`, `Conflict`, `Unavailable` or `InvalidInput`.
- The handler may ask only for the services of its scope and kind:

| Scope   | Query                                   | Command also gets |
| ------- | --------------------------------------- | ----------------- |
| `org`   | `Caller`, `OrgContext`, `OrgReader`     | `OrgWriter`       |
| `brain` | `Caller`, `BrainContext`, `BrainReader` | `BrainWriter`     |

When an operation is defined, it checks again what the compiler cannot see, on the encoded form of its schemas, the form that travels:

- the name matches `^[a-z][a-z0-9_]{0,63}$` and the route path is well formed;
- the input and the output are objects that declare their fields, or unions of such objects, with no empty struct at any depth (an input with no fields is `Schema.Record(Schema.String, Schema.Never)`);
- no input field is named `org`, nor `brain` at brain scope;
- each route parameter is a required string field of every member of the input;
- a field the handler calls `brain` also travels as `brain`.

At run time, when a handler fails with a reason it did not declare, the call fails; it is not rejected.

A definition sets `reachesOutside: true` when its handler calls a system outside the server, such as a model provider; the registration carries it, `false` when left out, and a transport can tell its callers, as the MCP tools do with `openWorldHint`.

`Unavailable` may carry a `kind`, `model_not_offered` for a model the server does not offer, and with it a `because`: `provider_not_configured` when the model's provider is not set up while others are, or `model_not_allowed` when the model is outside what the operator allows. Both reach the rejected outcome, where `explanationOf` and `unsuccessfulWords` turn them into plain words; neither is part of the problem document.

`InvalidInput` is for input that matches the input schema but that the handler finds wrong, such as a document it parses. It carries a detail and its issues, each a `detail` and a JSON Pointer `pointer` into the input. A handler that declares `invalid_input` and fails with it is rejected with reason `invalid_input` and those issues, the same rejection the dispatcher gives input that breaks the schema. Every rejection carries at most 100 issues, and each issue only its `detail` and `pointer`.

`getLabel.registration` is what a catalog stores: the route, the kind, the success status, the reasons, whether the operation targets a brain, whether it reaches outside the server, and JSON Schema for the input and output with their definitions kept apart. Its `run` decodes an input, runs the handler and encodes the output; only the dispatcher calls it, because it checks nothing about the caller.

`getLabel.call(input)` runs the handler in process with typed input and output, checking both against their schemas. This is how one operation calls another. The call runs with the authority of the calling operation: it does not check the permission of the operation it calls, nor run the pipeline steps.

`makeCatalog([getLabel, ...])` rejects a name used twice, and two operations with the same method and route once parameter names are ignored, where an org route is under `/orgs/{org}` and a brain route under `/orgs/{org}/brains/{brain}`. It lists the operations of each scope.

### The brain of an org operation

An org operation targets at most one brain, and names it `brain`. When its input declares a `brain` field, the dispatcher checks that the caller may access that brain, wherever the field arrives from: path, query or body. A second field that names a brain is not checked and must not be used. Whether that brain exists, and whether its id is well formed, is the handler's business at org scope, because the org's brain records are the handler's.

`canAccessBrain(access, brain)` is the access check the dispatcher applies, for a handler that lists only the brains its caller may access.

## The dispatcher

`makeDispatcher(steps)` returns `dispatchToOrg` and `dispatchToBrain`, which run one call through this pipeline. The first three steps authorize the call; the fourth confirms that its org and brain exist.

1. The caller's org must equal the org of the call, or the call is rejected with `forbidden`.
2. The caller must hold the permission of the operation's kind and scope: `org:read`, `org:write`, `brain:read` or `brain:write`.
3. At brain scope, and for an org operation that targets a brain, the caller must have access to that brain.
4. The org id must be well formed and, at brain scope, the brain id must be well formed and the brain must exist, or the call is rejected with `not_found`. An ill-formed id is never echoed back. A retired brain stays readable: a query runs on it as on an active brain, while a command is rejected with `conflict`, kind `retired`, and the detail `The brain <id> is retired and can no longer change`, the words `update_brain` uses for a retired brain.
5. The pipeline steps run in order.
6. The input is decoded, rejecting unknown keys and pointing at every problem, up to 100 of them. Input nested too deeply to decode is rejected the same way.
7. The handler runs.
8. The output is checked against the output schema and encoded as JSON.

A caller of one org gets the same `forbidden` rejection for an existing and a missing brain of another org. A caller's identity can be decoded with `CallerIdentitySchema`.

The outcome is `succeeded`, `rejected` or `failed`. The error boundary turns any defect into a `failed` outcome with an incident id. The `IncidentReporter` receives the id, the original defect and the call: the operation, the org, the brain when there is one, and the caller's id, never the input. It has two seconds; when it fails or takes longer, the incident id is logged with `Effect.logError`, and the outcome stays `failed`.

A transport runs a call with `settle(call, signal)` and always gets a `Settled` value: the outcome, or `cancelled` when the signal aborts the call or the call interrupts itself. Any other failure settles as `failed` with a reported incident.

The dispatcher needs a `Ledger`, a `BrainRegistry`, which answers the status of a brain, `active`, `retired` or `unknown`, and an `IncidentReporter`. Handlers can see none of them, neither in their types nor at run time. A handler can read any other service present in the runtime's context, so the runtime must expose only these three at its top level, and an adapter must keep its own dependencies, such as a database client, inside its layer.

## The ledger ports

A `Decider` holds the event-sourced rules of a stream: its initial state, how an event evolves the state, how a command decides on new events or a rejection, and the schema of its events. Every event has a string `type` naming what happened, which the ledger records beside it.

`Ledger` is the unbound port. It addresses streams by full name, loads a stream's state and version by folding its events, and runs a command through a decider, rejecting with `conflict` on a version conflict, when another write reached the stream between reading it and appending to it. The version of a stream is the number of events in it, 0 for a stream that does not exist. A conflict's detail must not name the stream. Its implementation lives with the ledger.

For each call the dispatcher binds the ledger to the call's address. `OrgReader` and `OrgWriter` prefix a stream name with `org/{org}/`; `BrainReader` and `BrainWriter` with `brain/{org}/{brain}/`. A handler names its streams relative to its org or brain: one or more segments of letters, digits, `_` and `-`, each at most 64 characters, joined by `/`, at most 256 characters in all. Any other name fails the call. So a handler has no way to name another org's or brain's streams. Stream names are case-sensitive, and a ledger implementation must treat them as opaque strings.

`streamPrefixOfOrg({ org })` returns the prefix of an org's streams, so code that holds the unbound `Ledger`, such as a `BrainRegistry`, reads the same stream a handler names relative to its org. `streamPrefixOfBrain({ org, brain })` does the same for a brain's streams. Such code must accept only well-formed org and brain ids (`OrgIdSchema`, `BrainIdSchema`), as the dispatcher does, so that a prefix names exactly one org or brain.

## Reading what a brain recorded

`Ledger.readRecorded(brain, selection, page)` reads one page of what a brain recorded, in the order the ledger recorded it, and answers `{ records, hasMore, nextCursor }`. Each record is `{ id, stream, type, data, recordedAt }`: `data` is the stored event as JSON, `recordedAt` the time the store recorded it in ISO 8601, and `id` the record's own cursor. The brain is matched exactly: a read of `acme/sales` never answers a record of `acme/Sales`, `acme/sales2` or `acme/sales_x`.

- The selection is `{ kind: 'everything' }`, the whole partition of the brain; `{ kind: 'run', execution }`, the two streams of one run, `executions/<id>` and `runs/<id>`; or `{ kind: 'executions' }`, the first and the latest message of every execution stream, ordered by the position of the first.
- The page is `{ cursor?, order, limit, since?, types? }`. `order` is `asc`, oldest first, or `desc`, newest first. `since` is the lower bound of the page in either order, by the time the store recorded. `types` keeps the records of those stored types; with `executions` it keeps the runs whose latest message is of those types, which is how a status filter is answered.
- A page is bounded by what the store examines and loads: it answers at most `limit` records, 1 to 100, examining that many without a `types` filter, and with one up to `mostExaminedInAPage`, 1,000 records, or 1,000 runs for `executions`, of which it answers those of its types, possibly none; and it loads at most 4 MiB of stored data, though the first record a page wants is always delivered. A bound ends the page with `nextCursor`, possibly with fewer records than asked or none. `boundedPage` applies these bounds over what a store examined, so every ledger bounds a page the same way.
- `nextCursor` is null when nothing remains. A reader at the end of the brain keeps the id of the last record it read and reads on from it later.
- A cursor is opaque. A cursor that does not decode as one fails the read with `InvalidCursor` of kind `malformed`, and one that another brain gave with kind `of_another_brain`.

`BrainReader.readRecorded(selection, page)` is the same read bound to the brain of the call, so a handler never reads another brain. It names streams relative to the brain, as `load` and `execute` take them, and turns `InvalidCursor` into `InvalidInput` at `/cursor`, which a handler that declares `invalid_input` passes on: `The cursor is malformed` for a malformed cursor, and `The cursor was not given by a read of this brain` for another brain's. A run's execution id must be a well-formed stream segment and a page must hold 1 to 100 records from a valid time; anything else fails the call.

The pieces of the operations that read the ledger:

- `PublicEventSchema` is an event as a caller reads it, `{ id, at, type, summary, data }`, its `data` at most 4 KiB as JSON in UTF-8.
- A `Presenter` turns a record of one stream kind into a public event, or `null` to hide it, and declares, for each stored type of its kind, the public name it presents it under, or `null` for a type it hides.
- `PagingInputFields` holds the optional input fields of a page, `limit` (1 to 100, `defaultPageLimit` 20 when left out), `cursor`, `order`, `since` and `type`, and `PagingOutputFields` the fields of an answer, `has_more` and `next_cursor`.

## Testing

`@beonauto/operations/testing` exports an in-memory `Ledger`, `BrainRegistry` and `IncidentReporter` for the tests of packages that define or serve operations. `memoryBrainRegistry(active, retired)` takes the active brains and, optionally, the retired ones; any other brain is unknown. The in-memory ledger reads what a brain recorded as the ledger does, and the behaviour suite of `@beonauto/ledger` runs on it.
