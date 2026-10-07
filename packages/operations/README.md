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
- The handler may fail only with the rejections it declares in `reasons`: `NotFound`, `Conflict`, `Unavailable`, `InvalidInput`, `RunCancelled`, the rejection of a run that was cancelled, with the kind `requested`, `deadline`, `overrun` or `parent_ended`, answered with HTTP 409 and no `Retry-After`, `RunUnanswered`, the rejection of a run whose request nobody answered, with the kind `expired` or `undelivered`, answered with HTTP 410 and no `Retry-After`, or `Forbidden`, for an operation that authorizes its caller itself (below).
- The handler may ask only for the services of its scope and kind:

| Scope   | Query                                   | Command also gets            |
| ------- | --------------------------------------- | ---------------------------- |
| `org`   | `Caller`, `OrgContext`, `OrgReader`     | `OrgWriter`                  |
| `brain` | `Caller`, `BrainContext`, `BrainReader` | `BrainWriter`, `CallLineage` |

When an operation is defined, it checks again what the compiler cannot see, on the encoded form of its schemas, the form that travels:

- the name matches `^[a-z][a-z0-9_]{0,63}$` and the route path is well formed;
- the input and the output are objects that declare their fields, or unions of such objects, with no empty struct at any depth (an input with no fields is `Schema.Record(Schema.String, Schema.Never)`);
- no input field is named `org`, nor `brain` at brain scope;
- each route parameter is a required string field of every member of the input;
- a field the handler calls `brain` also travels as `brain`.

At run time, when a handler fails with a reason it did not declare, the call fails; it is not rejected.

A definition sets `reachesOutside: true` when its handler calls a system outside the server, such as a model provider, and `mayChangeOutside: true` when that call may change something there, such as a tool that writes; the registration carries both, `false` when left out, and a transport can tell its callers, as the MCP tools do with `openWorldHint` and `destructiveHint`.

`Unavailable` may carry a `kind` and with it a `because`. Both reach the rejected outcome, where `explanationOf` and `unsuccessfulWords` turn them into plain words, and the problem document, as its extension members `kind` and `because`.

| `kind`                | What could not be used                                                                | `because`                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model_not_offered`   | a model the server does not offer                                                     | `provider_not_configured`, its provider is not set up while others are; `model_not_allowed`, it is outside what the operator allows                                                                    |
| `tool_not_offered`    | a tool the server does not offer                                                      | `mcp_server_not_configured`, its server is not configured for the org and brain; `tool_not_allowed`, it is outside what the operator allows; `tool_not_listed`, its server does not list it            |
| `mcp_server_failed`   | a tool server, before any call was recorded                                           | `failing`, it kept failing; `rate_limited`, it asked to wait longer than a run waits; `unreachable`, it could not be reached in time                                                                   |
| `tools_unfinished`    | anything, after a tool call was recorded, so that a tool may have changed something   | `server_failed`, a tool server kept failing; `model_unavailable`, the model could not be called; `run_bound`, the run ran out of time; `no_answer`, the model still called tools when it had to answer |
| `rebuilding`          | the view a recall function keeps, which is still being built from the brain's history | none; trying again later may succeed, and the kind has a problem type of its own, `kindsWithTypes`                                                                                                     |
| `channel_not_offered` | a channel the server does not offer the brain                                         | none; only the operator's configuration puts it right                                                                                                                                                  |
| `requests_full`       | room for one more open request in the brain                                           | none; trying again once some are answered, expire or are cancelled may succeed                                                                                                                         |

`Conflict` may carry a `kind`: `taken`, `retired`, `concurrent_change`, `unworkable`, `stalled`, the view a recall function keeps stopped at an event its fold could not take, which only a corrected version puts right, or `tools_called`, a run that called tools and did not succeed, or that started and calls tools and may still be in progress, and so is not run again under its id. The words of `tools_unfinished` and `tools_called` never say that nothing was changed: `Explanation` carries `mayHaveChanged` for them, since the tools of the run may have changed something even when the refused request ran nothing.

`InvalidInput` is for input that matches the input schema but that the handler finds wrong, such as a document it parses. It carries a detail and its issues, each a `detail` and a JSON Pointer `pointer` into the input. A handler that declares `invalid_input` and fails with it is rejected with reason `invalid_input` and those issues, the same rejection the dispatcher gives input that breaks the schema. Every rejection carries at most 100 issues, and each issue only its `detail` and `pointer`.

`InvalidInput`, `Unavailable` and `Conflict` may also carry a `record`, a JSON object of what was done before the rejection, such as the tokens a model call spent. No outcome or problem document shows it; `@beonauto/specs` keeps it on a run its runtime adapter rejected.

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

A brain request may carry a `lineage`, `{ causationId, correlationId }`: the message that caused the call and the run the call belongs to, a `depth`, the reaction depth of the run it starts (see the workflow host's reactions), a `callDepth`, the number of calls above the run it starts, and a `calledBy`, the call that run answers (`CallLink`: the execution id of the workflow, the call's reference and its run). Only callers in the same process set them, as the workflow host does when a workflow calls a function or a reaction starts a workflow; a transport never does, so no input reaches them. The brain binding gives them to a brain command as the `CallLineage` service, `{ lineage, depth, callDepth, calledBy }`, `lineage` and `calledBy` `null` and the depths 0 when the request carried none, and the command passes the lineage to `BrainWriter.execute` with the events it appends.

A definition sets `authorizesByToken: true` when its handler authorizes the caller itself, by a token the caller presents, as `answer_interaction` of `@beonauto/interaction` does with the answer token of a request. A transport hands such a token on unverified, as `requestTokenCallerOf(org, token)`: the caller `request-token` of that org, with no permission and no brain, carrying the token as `requestToken`. Every operation refuses that caller as `forbidden`, for it holds no permission, except one that authorizes by token, which the dispatcher runs without the checks of permission and brain access, its org still checked. For such a caller the dispatcher first decodes the input, with the registration's `checkInput`, so input that does not fit is `invalid_input` for every brain, and then answers every refusal of the brain, a malformed, missing or retired one, as a bad token, `forbidden` with `requestTokenRefused`, so a token tells nothing of which brains an org has; the handler must verify the token before it reads anything and fail with `Forbidden` and the same words when it does not. A caller without a token meets the checks of an operation that authorizes by token as of any other.

`brainCallerOf({ org, brain })` is the caller a brain acts as itself, for the work no person started, such as a run a reaction starts: `brain:<brain>`, with `brain:read` and `brain:write` on that brain and no other, an id no API key can hold, since key ids take no `:`.

The outcome is `succeeded`, `rejected` or `failed`. The error boundary turns any defect into a `failed` outcome with an incident id. The `IncidentReporter` receives the id, the original defect and the call: the operation, the org, the brain when there is one, and the caller's id, never the input. It has two seconds; when it fails or takes longer, the incident id is logged with `Effect.logError`, and the outcome stays `failed`.

A transport runs a call with `settle(call, signal)` and always gets a `Settled` value: the outcome, or `cancelled` when the signal aborts the call or the call interrupts itself. Any other failure settles as `failed` with a reported incident.

The dispatcher needs a `Ledger`, a `BrainRegistry`, which answers the status of a brain, `active`, `retired` or `unknown`, and an `IncidentReporter`. Handlers can see none of them, neither in their types nor at run time. A handler can read any other service present in the runtime's context, so the runtime must expose only these three at its top level, and an adapter must keep its own dependencies, such as a database client, inside its layer.

## The ledger ports

A `Decider` holds the event-sourced rules of a stream: its initial state, how an event evolves the state, how a command decides on new events or a rejection, and the schema of its events. Every event has a string `type` naming what happened, which the ledger records beside it.

`Ledger` is the unbound port. It addresses streams by full name, loads a stream's state and version by folding its events, reads what a brain recorded and the outcomes of its runs (below), and runs a command through a decider, rejecting with `conflict` on a version conflict, when another write reached the stream between reading it and appending to it. The version of a stream is the number of events in it, 0 for a stream that does not exist. A conflict's detail must not name the stream. Its implementation lives with the ledger.

Every message the ledger writes has an id, a cause and a correlation. Its id is `messageIdOf(stream, position)`, a version 5 UUID of the JSON array `[stream, position]` in a namespace of the ledger's own, so anyone who knows a stream and a position names the message without reading it; `uuidV5(namespace, name)` makes such ids. `execute(stream, decider, command, lineage?)` takes the `Lineage` of the events it appends, `{ causationId, correlationId }`: the id of the message that directly led to them, and the id of the run they belong to, the top-level run of a tree of runs. Both are `null` when left out.

For each call the dispatcher binds the ledger to the call's address. `OrgReader` and `OrgWriter` prefix a stream name with `org/{org}/`; `BrainReader` and `BrainWriter` with `brain/{org}/{brain}/`. A handler names its streams relative to its org or brain: one or more segments of letters, digits, `_` and `-`, each at most 64 characters, joined by `/`, at most 256 characters in all. Any other name fails the call. So a handler has no way to name another org's or brain's streams. Stream names are case-sensitive, and a ledger implementation must treat them as opaque strings.

`streamPrefixOfOrg({ org })` returns the prefix of an org's streams, so code that holds the unbound `Ledger`, such as a `BrainRegistry`, reads the same stream a handler names relative to its org. `streamPrefixOfBrain({ org, brain })` does the same for a brain's streams. Such code must accept only well-formed org and brain ids (`OrgIdSchema`, `BrainIdSchema`), as the dispatcher does, so that a prefix names exactly one org or brain.

## Reading what a brain recorded

`Ledger.readRecorded(brain, selection, page)` reads one page of what a brain recorded, in the order the ledger recorded it, and answers `{ records, hasMore, nextCursor }`. Each record is `{ id, cursor, causationId, correlationId, stream, version, type, data, recordedAt }`: `id` is the message id, `causationId` and `correlationId` its lineage, `cursor` the record's own cursor, `version` its position within its stream, from 1, `data` the stored event as JSON, and `recordedAt` the time the store recorded it in ISO 8601. The brain is matched exactly: a read of `acme/sales` never answers a record of `acme/Sales`, `acme/sales2` or `acme/sales_x`. [Decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) records the design of this read.

- The selection is `{ kind: 'everything' }`, the whole partition of the brain; `{ kind: 'run', execution }`, the two streams of one run, `executions/<id>` and `runs/<id>`; `{ kind: 'correlated', correlation }`, every message of the brain whose correlation is that run, in the brain's order; or `{ kind: 'executions', notBeginningWith? }`, the first and the latest message of every execution stream, ordered by the position of the first, leaving out the streams whose first message is of a type `notBeginningWith` names, which the store passes over before it counts the page, so a page of runs is full and `hasMore` true only while runs remain.
- The page is `{ cursor?, order, limit, since?, types?, dataOf? }`. `order` is `asc`, oldest first, or `desc`, newest first. `since` is the lower bound of the page in either order, by the time the store recorded. `types` keeps the records of those stored types; with `executions` it keeps the runs whose latest message is of those types, which is how a status filter is answered. `dataOf` reads the heads of the records: only the records of those stored types carry their `data`, and the others come with their id, cursor, lineage, stream, version, type and time, `data` left out, and count nothing toward the 4 MiB a page loads, so a reader that follows a brain passes a run log's records of up to 1.5 MiB at the cost of their heads; `dataOf: []` loads no data at all.
- A page is bounded by what the store examines and loads: it answers at most `limit` records, 1 to 100, examining that many without a `types` filter, and with one up to `mostExaminedInAPage`, 1,000 records, or 1,000 runs for `executions`, of which it answers those of its types, possibly none; and it loads at most 4 MiB of stored data, though the first record a page wants is always delivered. A bound ends the page with `nextCursor`, possibly with fewer records than asked or none. `boundedPage` applies these bounds over what a store examined, so every ledger bounds a page the same way.
- `nextCursor` is null when nothing remains. A reader at the end of the brain keeps the cursor of the last record it read and reads on from it later.
- `lastExamined` is the place of the last record the page examined, `{ cursor, recordedAt }`, or null when it examined none: the record `nextCursor` reads on after when a bound ends the page, and at the end of the brain the last record there, even one of a type the page did not want, so a reader that keeps a checkpoint of what it has examined, as the workflow host's projector does, moves past records it filters out. `boundedPage` names it as `lastExamined`.
- A cursor is opaque to callers: the base64url encoding, without padding, of a JSON array, the brain key first (`cursorOfParts`, `partsOfCursor`). A record's cursor reads on after the record. `cursorWithin(cursor, index)` adds one more part, a number, the index of the last event of the record a page answered; a read from such a cursor begins with that record, and the events of the record up to that index are left out by whoever presents them. A cursor that does not decode as one fails the read with `InvalidCursor` of kind `malformed`, and one that another brain gave with kind `of_another_brain`.

`BrainReader.readRecorded(selection, page)` is the same read bound to the brain of the call, so a handler never reads another brain. It names streams relative to the brain, as `load` and `execute` take them, and turns `InvalidCursor` into `InvalidInput` at `/cursor`, which a handler that declares `invalid_input` passes on: `The cursor is malformed` for a malformed cursor, and `The cursor was not given by a read of this brain` for another brain's. A run's execution id must be a well-formed stream segment and a page must hold 1 to 100 records from a valid time; anything else fails the call.

The pieces of the operations that read the ledger:

- `PublicEventSchema` is an event as a caller reads it, `{ id, cursor, causation_id, at, type, summary, data }`, its `data` at most 4 KiB as JSON in UTF-8: `id` the message id, or another id that stays the same on every read, `cursor` the place to read on from, and `causation_id` the id of the event that directly led to it, or `null`.
- A `Presenter` turns a record of one stream kind into a list of public events, possibly empty, and declares, for each stored type of its kind, the public names it presents it under, none for a type it hides.
- `presentationOf(presenters)` presents a record by the presenter of its stream kind, the name of its relative stream up to the first `/` (`streamKindOf`), and hides a record of a kind no presenter presents, or of a stored type its presenter declares no public name for. It lists the public types of all its presenters and translates one to the stored types it stands for, which is how a filter by public type is read. Two presenters of one stream kind are refused.
- `eventsPageOf(presentation, page, paging)` turns a page of records into a page of events, `limit` of them at most: each record's events in their order oldest first and backwards newest first, those a cursor inside the record says were answered left out, and those `keeps` refuses. When the limit falls inside a record, the page ends there, with `cursorWithin` the record's cursor and the index of the last event answered.
- `PagingInputFields` holds the optional input fields of a page, `limit` (1 to 100, `defaultPageLimit` 20 when left out), `cursor`, `order`, `since` and `type`, and `PagingOutputFields` the fields of an answer, `has_more` and `next_cursor`.

## The outcomes of runs

`Ledger.readRunOutcomes(brain, window, selection)` reads the outcomes of a brain's runs, one row per run, that the ledger keeps as their events are appended, and answers them in groups: one for each day a run first started, its `primitive`, its `name` and its `status`, `started`, `succeeded`, `failed` or `rejected`, with how many `runs` the group holds, the sums of their `inputTokens`, `outputTokens` and `cachedTokens`, 0 where none recorded a number, and the `durations` of the runs that have one, in no order. The `window` is `{ from, to }`, two days as `YYYY-MM-DD`, both included; the `selection` keeps one `primitive`, one `name`, or both. The groups come in no order. The brain is matched exactly, as for the read of what a brain recorded.

What a row holds is not the ledger's to know: a `RunOutcomeMapping`, `{ types, rowAfter }`, which the package that owns the run events supplies and the composition root gives the ledger, names the stored types that change a row and turns the row of a run, or none, and one of its events, as the ledger's reads decode it, into the row to keep, or `undefined` to keep the row as it is. A `RunOutcome` holds `startedDay`, `startedAt`, `lastStartedAt`, `primitive`, `name`, `status`, `durationMs` and the three token counts, each `null` when unknown. The mapping must never throw: the ledger calls it inside the append. `runStreamOf(stream)` tells whether a stream is a run's, named `<brain key>executions/<id>` with nothing nested under it, and answers its brain key and run id.

`BrainReader.readRunOutcomes(window, selection)` is the same read bound to the brain of the call.

## The projections of runs

A `RunProjection` is a table the ledger keeps of runs, one row a run, inside the append of each event of the types it names, as it keeps the outcomes of runs; the package that owns what a row means declares it and the composition root registers it with the ledger. It names its `name` and `version`, whose table is `projectedTableOf`, `<name>_<version>`, so a change to what it keeps is a new version and a new table; the stored `types` that change a row; its `columns`, each `text`, `integer` or `boolean`, beside the `brain_key` and `run_id` that key every row; its `indexes`, each on the brain and its columns, or on its columns alone across brains with `acrossBrains`, and partial with `whereSet` on a column that is set; and `rowAfter(row, event, message)`, which turns the run's row, or none, the event as a read decodes it, and the message's `id` and `position` into the row to keep, or `undefined` to keep the row as it is. It must never throw. `checkedProjection` refuses a name, a version, a column or an index a table cannot hold.

`Ledger.readProjectedRows(projection, brain, query)` reads the rows of one brain whose columns equal the values of `query.where`, `run_id` among them for the row of one run, ordered by `orderBy` and then the run id, `asc` or `desc`, after the values `after` names when it is given, at most `limit`; `countProjectedRows(projection, brain, where)` counts them; `readDueRows(projection, { column, through, limit })` reads the rows of every brain whose integer `column` is set and at most `through`, the soonest first; and `nextDueOf(projection, column, after)` answers the smallest value of the column after `after`, or `null`, so a reader that holds back rows already due still learns when the next one comes. A projection the ledger does not keep answers no rows. `BrainReader` holds the first two, bound to the brain of the call. `lineageAttributeNames` are the extension attributes of an event that carry the lineage of a record, `causationid` and `correlationid`. A window whose days are not days of the calendar, such as `2026-02-30`, or whose `to` comes before its `from`, fails the call: the operation that reads it checks its input first. `isCalendarDay(text)` is that check, a `YYYY-MM-DD` that names the same day when read back; `PagingInputFields.since` holds its date to it as well, and its hours, minutes and offset to their ranges, so `2026-02-30T00:00:00Z` is refused rather than read as 2 March and `2026-10-05T24:00:00Z` rather than read as the next midnight.

## Testing

`@beonauto/operations/testing` exports an in-memory `Ledger`, `BrainRegistry` and `IncidentReporter` for the tests of packages that define or serve operations. The in-memory ledger names and links its messages as the ledger does. `memoryBrainRegistry(active, retired)` takes the active brains and, optionally, the retired ones; any other brain is unknown. `memoryLedger(runOutcomes)` keeps the outcomes of runs with the mapping it is given, and none without one; an append whose mapping throws keeps nothing. `runTallies` is a small `RunOutcomeMapping` over `runFacts`, a decider that appends the `run_began` and `run_ended` facts it is given, for the tests of a ledger. `memoryLedger(runOutcomes, projections)` keeps the projections it is given too, and `runTallyRows`, `tallyRowsOf(version)` and `readTallyRows` are a small projection over the same facts and a query of it, for the tests of a ledger's projections. The in-memory ledger reads what a brain recorded as the ledger does, and the behaviour suite of `@beonauto/ledger` runs on it.
