# 0002 — Reading the runs of a brain and what happened in it

**Status:** accepted (2026-10-05), revised twice after audit the same day

## Context

A brain records everything it does on the ledger, one stream per thing:

- Every run is a stream, `executions/<id>` under the brain's prefix `brain/<org>/<brain>/`, written by the execution decider: `execution_started`, `execution_deferred`, `execution_succeeded`, `execution_rejected` and `execution_failed`, each with who caused it and when. `get_execution` folds one such stream and shows the latest start. A caller may supply the id, a workflow's child runs get ids derived by hashing, and a run started again with the same id records a new start, so an id says nothing about order. A start carries the run's input, up to 256 KiB; a finish carries its output and record, up to 1 MiB together; both are tenant JSON that may hold any character, including U+0000.
- The brains of an org and the specs of a primitive are registries: one stream each, written by a decider, because they enforce an invariant, a unique name. A brain's own lifecycle, created, updated and retired, is recorded in the org's registry stream, outside the brain's partition.
- A workflow run also has the engine's run log, one stream per run (decision 0001): a state-transition log whose events, `input_applied`, carry the receipt of the input with its time, the steps it moved, the outputs it produced and the patch to the state. On the hosted runtime that stream lives in the run's own isolate, not in the brain's object, so a run's two streams share no position there.
- `POST /executions/{execution_id}/events` already exists: `send_execution_event` sends an event into a workflow.

The ledger port reads one stream and appends to one stream, through the event store's own operations only, with no SQL of its own. Both stores underneath, SQLite and PostgreSQL, keep for every message its stream, a global position and a recorded time; PostgreSQL also keeps the transaction id, and a position becomes visible before an earlier one has committed, which Emmett's own batch read handles by ordering by transaction id and position and reading behind the oldest open transaction. On PostgreSQL, reading a field out of an event's JSON fails the whole query when the event holds U+0000 anywhere in it. Several self-hosted servers may share one PostgreSQL database; the hosted runtime's shared database driver commits each statement on its own.

Nothing lists the runs of a brain or of a spec, nothing reads what happened inside one run, and nothing shows what happened in a brain. A caller learns a run id from the answer of `execute_spec` or from an event it sent.

In text a user reads, an execution is a run. Code and the API keep the word execution.

## Decision

### 1. Every read is a read of the ledger; no read model until a measured need

Three kinds of read, each the simplest thing that is correct:

- A **registry** enforces a rule across its members, so it stays a decider over one stream, as today.
- A **list of runs** is a query over the brain's partition of the ledger: the first message of every execution stream, newest first by its position, joined with the latest message of the same stream for the status. It is exact, it has nothing to rebuild, it needs no projection, and it works wherever the brain's record lives. A read model is the upgrade when the measurement in this record says a page is too slow; it is not built now.
- A **feed** and a **run's history** are the ledger's own order within the brain's partition.

### 2. The ledger port grows one read, bound to a brain

```
readRecorded(brain, selection, page) => { records: [{ id, stream, type, data, recordedAt }], hasMore, nextCursor }
  selection: everything in the brain | the streams of one run | the first and the latest message of every execution stream
  page: { cursor?, order: 'asc' | 'desc', limit, since?: time, types?: stored types }
```

- The brain is matched **exactly** on a key derived from the stream name, never with a pattern: org and brain ids allow uppercase and underscores, SQLite's `LIKE` ignores case and `_` is a wildcard in both stores. The key is indexed with the position on SQLite and with the transaction id and the position on PostgreSQL, so a page costs the same at any depth of any brain in either order. `since` seeks the index on the key and the recorded time: it is the lower bound of a page in either order, by the store's time, which SQLite keeps to the second and PostgreSQL as the transaction's start. Reading one run uses the stream's own index. The list of runs reads the latest message of a stream through the stream's own unique index; nothing is read out of an event's JSON in SQL.
- On PostgreSQL the read orders by transaction id then position and stays behind the oldest open transaction, exactly as Emmett's batch read does, so a message committed late is never skipped; the tail of the feed therefore waits for the slowest open append in the database. On SQLite appends are serialised and positions follow commit order.
- A **cursor is opaque** to callers and to the operations layer: an encoding of what the store needs to resume, the position and on PostgreSQL the transaction id, together with the brain key, verified on decoding. A cursor that does not decode or belongs to another brain is `invalid_input` at `/cursor`. The encoding is not encrypted: a caller who decodes it learns a position of the ledger, which on a shared self-hosted ledger says how much the whole ledger has written; the hosted runtime keeps one ledger per brain. Every response carries `next_cursor`, null when nothing remains, because hidden records and the filters can make a page empty while more remains.
- A page is bounded three ways, all counted over what the store **examines**, not what it returns: 1 to 100 records returned, 20 by default; 4 MiB of stored data loaded, because one record may be 1.5 MiB; and 1,000 runs examined by the list of runs. When a bound is reached the page ends with `next_cursor`, possibly with fewer records than asked or none, the way a budgeted scan answers.
- The read is added to `Ledger` and to `BrainReader`, bound to the brain in the brain binding, so a handler cannot read another brain, and to the in-memory ledger with the agreement suite that every store passes.
- The brain-key index is the first index the ledger adds to the store's table. It is created when the ledger opens, with `CREATE INDEX IF NOT EXISTS`, inside the existing migration; on PostgreSQL the one-time build blocks appends for about a second per million messages, which the README states. The ledger's portability section changes from "no SQL" to "one SQL read per store and its index, nothing on the write path".

### 3. Public events are a presentation of recorded events, never the records themselves

Stored events are the domain's; what a caller reads is a public event, produced by a **presenter** that the package owning the stream kind supplies, in the way primitives supply their descriptions today:

```
present(recorded) => PublicEvent | null
PublicEvent { id, at, type, summary, data }
```

- `id` is the record's opaque cursor; `at` is the event's own time, so an event just before `since` by its own clock may appear, and an event's `at` and its store time differ by the time between deciding and committing. Stream names and positions are not fields of a public event.
- `type` is a stable public name independent of the stored one. A presenter declares which stored types it presents and under which public name; the `type` filter of the feed takes one public name, which the operation translates to the stored types before the read.
- A record whose stream kind has no presenter is hidden; `null` hides a record of a known kind. Snapshots and the dispatch watermark are not events, and the Node adapter keeps them out of the brain's prefix.
- `summary` is plain words with no ids, positions or slashes, and counts written as words where the internal-terms check demands it. `data` is at most 4 KiB, by these rules: an input, an output, a record, a spec document and its schemas appear as byte sizes; the steps an input moved and the issues of a rejection appear as a count and the first five; a rejection's detail is cut at a code point; a spec's description at 300 characters; its warnings as a count. The engine's `input_applied` presents as one public event per input: the kind and key of the input, its steps so bounded, and the kinds of output it produced; the patch is never shown.
- A test over the catalog of event schemas enforces that every event type of every registered stream kind has a presenter decision, and that no public event exceeds its bound at the largest stored record.

### 4. The three operations

All three are brain-scoped queries under `brain:read`, on HTTP and MCP, with the plain-language block first as every operation has.

| Operation               | Route                                    | Input                                                                      | Output                                                                   |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `list_executions`       | `GET /executions`                        | `primitive?`, `name?`, `status?`, `limit?`, `cursor?`                      | `{ executions: [ListedExecution], has_more, next_cursor }`, newest first |
| `get_execution_history` | `GET /executions/{execution_id}/history` | `cursor?`, `order?` (oldest first by default), `limit?`                    | `{ events: [PublicEvent], has_more, next_cursor }`                       |
| `list_brain_events`     | `GET /events`                            | `cursor?`, `since?`, `type?`, `order?` (newest first by default), `limit?` | `{ events: [PublicEvent], has_more, next_cursor }`                       |

- `ListedExecution` is the execution as `get_execution` shows it, the latest start included, without its output, its record and the issues of a rejection: id, primitive, name, spec version, status, who started it, when it started, when it finished, and the reason and kind of a rejection. Runs are ordered by the position of their first start, which is unique, so two runs started in the same millisecond keep a fixed order across restarts.
- The `status` filter is answered in the store from the latest message's type. The `primitive` and `name` filters are applied by the operation after decoding each first message, within the page's bounds, so a filter that matches rarely returns short or empty pages with `next_cursor` until it finds matches.
- `get_execution_history` merges the run's execution stream and, for a workflow run, its run log, by each record's own time, then stream, then stream version; it never relies on a shared position, because the hosted runtime has none across the two. The history of a workflow run can show it finished while `get_execution` still says started, because the run log and the run's record are two writes (decision 0001, invariant 14); the record follows within the retry of the settle output.
- `list_brain_events` reads the brain's whole partition: specs created, changed and retired, runs started and finished, workflow inputs applied where the run logs live in the partition, and whatever a later decision adds. On the hosted runtime the run logs live in the runs' isolates, so the feed there shows a run's start and finish, and `get_execution_history` reads the run's own log.
- What the feed cannot show, and the records say so: the brain's own creation, update and retirement, which live in the org's registry stream.
- **Retired brains stay readable.** Every brain-scoped query may read a retired brain and every command is refused with the reason `update_brain` already uses for one. The brain registry port answers a status, active, retired or unknown, instead of a boolean, the dispatcher applies the rule by the operation's kind, and the in-memory registry follows. A brain's history survives its retirement.
- `limit` and `has_more` follow the list convention of the OpenAI API; `cursor` and `next_cursor` are the opaque continuation that Slack's and Notion's APIs use; `since` follows GitHub. Output envelopes keep noun keys, `executions` and `events`, as `specs` and `brains` do today.

### 5. What is not in this decision

A live tail of the feed over Server-Sent Events, resuming from `Last-Event-ID` as the opaque cursor, is additive on this design and waits for a change signal per store. An org-wide feed, counts and activity windows, retention and what a cursor older than the retention horizon answers, a link from a workflow's child run to its parent, encrypted cursors, and a read model for runs when the measurement demands it are later decisions.

## Consequences

- The list, the history and the feed are exact reads of the ledger: no lag, no rebuild, no projection to version. The ledger gains one SQL read per store and one index, and nothing on its write path.
- The cost is at read time and bounded by the page: an unfiltered page at any depth of a brain of 100,000 runs reads in about a millisecond on PostgreSQL and under a tenth on SQLite from the index; a status filter costs a few milliseconds; a name filter that matches rarely costs pages, not time. The build records these numbers on a ledger of a million messages with inputs and outputs at their largest.
- Nothing about a run leaves its brain: the brain key is matched exactly, the read is bound in the brain binding, and a cursor is verified to belong to the brain that reads it.
- The engine's run log becomes readable by people through its presenter only; its patches stay internal, and the engine's state formats and upcasters stay the only place that knows them. The run store takes the brain's address with the execution id, because execution ids are unique within a brain only.
- A primitive that keeps its own log of a run brings a presenter for it; presenters are passed to the operations the way primitives are passed to `makeSpecOperations`, so `@beonauto/brains` keeps depending on operations only.
- New code goes in new concept folders: the ledger has eleven files directly under `src` and the specs operations folder seventeen, both already at the rule's edge.

## Verification the build must include

- The partition read never returns another brain's message: a brain named with uppercase, one with an underscore, and a prefix lookalike all read only their own.
- On PostgreSQL, a page taken while an earlier append's transaction is open, then after it commits, delivers every message exactly once, in both orders; on SQLite the same holds.
- Paging: no duplicate and no gap across pages while appends continue, in both orders; each of the three bounds ends a page with `next_cursor`; a page emptied by a filter still carries `next_cursor`; a malformed cursor and another brain's cursor are `invalid_input` at `/cursor`.
- Ordering of runs: a caller-supplied id, a hashed child id and a run started twice all take their place by first start; the order is fixed across restarts.
- A run whose input or output holds U+0000 lists, filters and reads on both stores.
- Every event type of every registered stream kind has a presenter decision; the largest stored record of every kind presents within 4 KiB; a stream kind without a presenter is hidden.
- The plain words pass the internal-terms check, and the three operations answer through the real server over HTTP and MCP, including on a retired brain, where a command is refused.
- The in-memory ledger passes the same agreement suite as both stores for the new read.
- The measurement: a ledger of a million messages with a brain of 100,000 runs, inputs and outputs at their largest, with the time of a page of each operation recorded in the ledger's README; the bar for staying without a read model is 50 ms for an unfiltered or status-filtered page.

## Build

1. `@beonauto/ledger`: the brain-bound recorded read in both stores, the index and its creation, the opaque cursor, the three bounds, the shared behaviour suite and the measurement. `@beonauto/operations`: the read on `Ledger` and `BrainReader`, the in-memory ledger, the brain registry's status and the dispatcher's rule for retired brains, the `PublicEvent` schema, the presenter type and the paging fields. Starts now, on main.
2. `@beonauto/specs`: `list_executions`, the presenters of execution and spec registry events, `get_execution_history`. `@beonauto/brains`: `list_brain_events` taking presenters as a parameter, and the brain registry answering a status. Starts after 1.
3. `@beonauto/workflow-engine` and the orchestration primitive: the presenter of `input_applied`, and the run store keyed by brain and execution, once the Node adapter writes run logs under the brain's prefix. Waits for the machine.
