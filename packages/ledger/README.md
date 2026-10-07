# @beonauto/ledger

The ledger keeps track of every single action and interaction that the brain does. It is the log of the inputs and outputs to all the primitives.

This package is the event store behind the `Ledger` port of `@beonauto/operations`. It stores events with [Emmett](https://event-driven-io.github.io/emmett/) on SQLite or on PostgreSQL.

## What it stores

- **Streams of events.** The application layer names each stream, for example `org/acme/brains` or `brain/acme/sales/specs/inference`. Names are opaque: the ledger never changes their case, trims them or normalises their Unicode, so two names that differ in any character are two streams.
- **One version per stream.** A stream's version is the number of events in it, and 0 when nobody has written it.
- **The outcomes of runs.** One row per run in the table `run_outcomes_1`, kept inside the append of each of the run's events, which a brain's analytics read (see [The outcomes of runs](#the-outcomes-of-runs)).
- **Events as Emmett stores them.** Each event becomes `{ type, data, metadata }`. `type` is the event's own `type`. `data` is the whole event encoded with `Schema.toCodecJson(decider.eventSchema)`, which must give a JSON object. Loading decodes `data` with the same codec, so an event comes back exactly as it was decided, dates and big integers included. A stored event that no longer decodes is a defect.
- **An id, a cause and a correlation for every message.** The store's append writes, in each message's metadata, `messageId`, which Emmett also keeps as the message's `message_id` and honours when the caller gives it, `causationId` and `correlationId`. The id is `messageIdOf(stream, position)` of `@beonauto/operations`, a version 5 UUID of the stream and the position the message takes, which the append knows before it writes since every append passes the version it expects; so no two messages share an id, and anyone who knows a stream and a position names its message. The cause and the correlation are the `Lineage` the command was executed with, `null` when it was given none. Messages written before the ledger set its own ids keep the random ids Emmett gave them, and no cause or correlation.

## How a command runs

`execute(stream, decider, command, lineage?)` loads the stream, folds its events with `decider.evolve`, and asks `decider.decide`; the events it appends carry the lineage.

- A rejection is returned as it is, and nothing is appended.
- A decision of no events appends nothing and answers with the current state and version.
- Otherwise the events are appended with the version that was read as the expected version. If another writer appended first, the append meets a version conflict: the stream is loaded and the command decided again, up to three more times, and then it fails with `Conflict`. Like the in-memory ledger of `@beonauto/operations`, its detail names no stream.
- A decision of more events than the store takes in one append is a defect: eight on SQLite, 64 on PostgreSQL.
- Any other failure of the database is a defect, never a `Conflict` or a rejection.

## Building on the ledger's loop

Code that keeps its own streams, such as `@beonauto/workflow-engine`, uses the same pieces as the ledger itself rather than a copy of them:

- `sqliteEventStore(optionsOf, runOutcomes?)` opens the event store on any of Emmett's SQLite drivers, without the layer, and `postgresqlEventStore({ connectionString, reportLostConnection, runOutcomes? })` from `@beonauto/ledger/postgresql` opens it on PostgreSQL; given a run outcome mapping, the store keeps the outcomes of runs. Both are one adapter over an Emmett event store, `emmettEventStore`, given how each keeps an event's data and how many events it takes in one append, beside the store's own read of what a brain recorded, `EventStore.readRecorded` (see [Reading what a brain recorded](#reading-what-a-brain-recorded)).
- `EventStore.read(stream, after)` gives the events after version `after`, the lineage of each, `{ id, causationId, correlationId }`, and the version of the whole stream, so a reader that holds a snapshot at version `after` reads only the tail. Emmett answers a read past the end of a stream with version 0; `read` answers with `after` instead.
- `EventStore.mostEventsInOneAppend` is the most events the store takes in one append.
- `eventAppenderOf(store, eventSchema)` encodes and appends events with an expected version and, when given, their lineage, at most `store.mostEventsInOneAppend` in one append, and fails with `VersionConflict` when another writer appended first.
- `retriedOnVersionConflict(attempt)` runs a load-decide-append attempt again after a version conflict, up to three more times, and then fails with `Conflict`.
- `EventStore.definitionStreams(type)` names the streams of one type of definition in every brain, such as each brain's `specs/recollection`, with the version of each, read from Emmett's table of streams through an index of their own (see [The indexes](#the-indexes)), so a reader that follows the definitions of one type, as the workflow host follows recall functions, finds a brain whose first definition of the type was saved after it started.
- `appendSignal()` is an in-process signal of appends to brains: `raise(stream)` tells every listener the brain key of a stream, its name through the third `/`, and nothing for a stream of no brain, and `listen(listener)` answers the function that stops listening. `signalledOn(store, signal)` raises it after each append the store recorded, never after one that failed, and the layers take it as `appends`, `ledgerLayer({ fileName, appends })` and `postgresqlLedgerLayer({ connectionString, appends })`, so code in the same process that follows a brain, as the workflow host's projector does, wakes when something was recorded rather than at its next sweep. Appends made by another process raise nothing here.
- `decisionLoop(load, append, decider)` is the load-decide-append loop itself, the one `Ledger.execute` runs: it loads, decides, appends the decided events with the loaded version expected, giving the append what the load gave too, retries with `retriedOnVersionConflict`, and answers with what the load gave, the events and the folded state. The ledger's load folds the whole stream; a caller with snapshots passes a load that folds a snapshot and its tail.

## Reading what a brain recorded

`Ledger.readRecorded(brain, selection, page)`, the read the `Ledger` port of `@beonauto/operations` describes, is answered by the store: one SQL read of its own on each store, over Emmett's messages table, with five indexes the ledger adds to it. Each record carries its id, cause and correlation, read from the message's `message_id` and metadata: on SQLite with `json_extract(message_metadata, '$.causationId')`, on PostgreSQL with `message_metadata ->> 'causationId'`, which Emmett keeps as `jsonb` and which never holds tenant data. The selections, the page and its bounds are the port's; this section says how each store answers them. [Decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) records why the read is a read of the ledger and how it was measured.

### The brain key

Every stream of a brain is named `brain/<org>/<brain>/…`. The store takes the key of a message's stream, its name through the third `/`, with an expression, and compares it to the brain's key, `brain/<org>/<brain>/`, for equality: with `=` on SQLite, and on PostgreSQL with `= ANY` of a list that holds the key alone, for the reason [How PostgreSQL reaches the indexes](#how-postgresql-reaches-the-indexes) gives. It never matches with `LIKE` or any pattern: org and brain ids may hold uppercase letters and `_`, SQLite's `LIKE` ignores case, and `_` matches any character in both stores. A stream name with fewer than three `/` has no key and belongs to no brain.

| Store      | The key of a stream                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| SQLite     | `substr(stream_id, 1, …)` to the third `/`, found with nested `instr`, since SQLite has no regular expressions |
| PostgreSQL | `substring(stream_id FROM '^(?:[^/]*/){3}')`, null for a name with fewer than three `/`                        |

The same expression taken to the fourth `/` gives the key of a stream's kind within its brain, such as `brain/acme/sales/executions/`. A run is a stream whose kind key ends in `executions/`, so no other stream may be nested under `executions/`.

### The indexes

| Index                                      | SQLite                                                           | PostgreSQL                                                                | What reads it                                               |
| ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ledger_messages_by_brain`                 | brain key, position                                              | brain key, transaction id, position                                       | a brain's messages, in order, from any cursor               |
| `ledger_messages_by_brain_and_time`        | brain key, recorded time                                         | brain key, recorded time, transaction id, position                        | where a page `since` a time starts                          |
| `ledger_messages_by_stream`                | stream, position                                                 | stream, transaction id, position                                          | one run's two streams, each in order from any cursor        |
| `ledger_first_messages_by_kind`            | kind key, position, first messages alone (`stream_position = 1`) | kind key, position in the stream, transaction id, position, every message | the runs of a brain, by the position of their first message |
| `ledger_messages_by_brain_and_correlation` | brain key, correlation, position                                 | brain key, correlation, transaction id, position                          | what one run and the runs it caused recorded, in order      |
| `ledger_definition_streams`                | the type of a definition stream, definition streams alone        | the type of a definition stream, definition streams alone                 | the definition streams of one type in every brain           |

The read of one run reads each of its two streams through the third index from the cursor on, and merges them, so a page of a run of 100,001 messages costs the same at its start and in its middle, in either order. Without it, SQLite read such a run through Emmett's unique index on the stream and its version and sorted what it read: on a file holding a run of 100,001 messages and 100,000 messages of other streams of its brain, a page took 24 ms at the start of the run newest first, 14 ms from its middle newest first and 4.7 ms from its middle oldest first, against 0.23 to 0.42 ms with the index.

The read by correlation walks the fifth index, whose second column is the message's correlation taken from its metadata by an expression, `json_extract(message_metadata, '$.correlationId')` on SQLite and `(message_metadata ->> 'correlationId')` on PostgreSQL, as the other indexes take their keys from the stream name, so a page of a run's whole tree costs the same however much else the brain recorded. On the ledger of [Measurement](#measurement), where every message of a run carries the run as its correlation, a page of the tree of a run of 21 messages took 0.28 to 0.29 ms on SQLite and 1.99 to 2.04 ms on PostgreSQL at the median, a page from the middle of the tree of a run of 100,001 messages 0.26 ms and 1.44 to 2.19 ms, and, behind a million newer messages of other brains, 0.26 to 0.31 ms and 1.52 to 1.81 ms, as a page of one run took.

The sixth index is on Emmett's table of streams, `emt_streams`, not on its messages: its key is the type a definition stream holds, the part of a stream's name after `brain/<org>/<brain>/specs/`, such as `recollection`, taken with `CASE WHEN … = 'specs/' THEN substr(…) END` over the brain key on SQLite and `substring(stream_id FROM '^(?:[^/]*/){3}specs/([^/]+)$')` on PostgreSQL, and it is partial, holding the streams whose key is not null, so it holds one entry for each brain and type of definition however many runs and other streams the ledger keeps. `definitionStreams(type)` matches the same expression with `=`, which both planners take as implying the index's `IS NOT NULL`, so the read walks the index; a test reads the plan on each store. Without it the read scans every stream of the ledger.

The list of runs walks the fourth index through the first message of each run, so a page of runs costs the same however many messages the run logs of a brain hold between two runs. A selection that names `notBeginningWith` leaves out, in the same walk, the streams whose first message is of those types, before the page counts its runs, so the page is full and has no more only once the runs are read; `@beonauto/specs` leaves out a stream that begins with a caller's cancel, which holds no run, and the ledger itself names no event. Without it, on a ledger of 598,362 messages, PostgreSQL estimated 845 first messages of runs where there were 60,000, and answered a page of runs filtered by status with a sequential scan of the whole table, in 122 to 126 ms; with it, the same pages took 1.4 to 3.5 ms. On SQLite the index holds the first messages alone. On PostgreSQL it holds every message, with its position in its stream as the second column, which the read asks to be 1, because the planner takes no statistics from the expression of an index with a `WHERE` clause: with the index partial, as on SQLite, on the ledger of [Measurement](#measurement), it planned a deep page of failed runs oldest first as a bitmap scan of the brain's runs and a sort of 49,999 of them, in 73 ms; whole, and with the table analysed, the same page took 4.4 ms.

The ledger creates the indexes when it opens, but first looks them up by name in the catalog, `pg_class` on PostgreSQL and `sqlite_master` on SQLite, which takes no lock on the messages table, and creates only those missing, with `CREATE INDEX IF NOT EXISTS`. A start that finds them all issues no `CREATE`. That matters on PostgreSQL, where `CREATE INDEX`, even on an index that exists, takes a lock on the messages table that waits for the appends in flight and holds every new append behind it: with an append left open for 2 s, `CREATE INDEX IF NOT EXISTS` on an index that existed took 2,013 ms, and an append begun 200 ms after it waited 1,821 ms; a start that looked first took 15 to 17 ms with the append still open, and a test checks that such a start is not held up. On PostgreSQL the lookup and the creation run in Emmett's `onAfterSchemaCreated` hook, inside the migration's transaction and its migration lock, so servers that start together build each index once; a start that created any index then analyses both tables, `ANALYZE emt_messages, emt_streams`, so the planner has statistics on the new key expressions at once rather than when autovacuum next analyses the table. On SQLite, which serialises writers, they run just after Emmett's migration, on the same connections, and the hooks a caller passes to `sqliteEventStore` are kept as given.

Building the five indexes on an existing ledger of 1,197,287 messages took 6.1 s on PostgreSQL 18.6, with the analysis, and 4.2 s on SQLite, about 5.1 s and 3.5 s per million messages at that size, measured as the time the ledger took to open (see [Measurement](#measurement)). On PostgreSQL the build blocks appends for as long, so the first start after an upgrade holds appends that long. The database's user must own the messages table to create them, as the user that created it does.

### How PostgreSQL reaches the indexes

Each index leads with its key, the brain's, the stream's or the kind's, then the order of the read, so a page walks the index from its cursor. PostgreSQL's planner may walk another index instead: Emmett's own on `(transaction_id, global_position)`, the order of the whole table, filtering out every message of another brain. It does so when its statistics say the key is common, as for a large brain, and the cost then grows with the messages other brains have written since: a page of the brain newest first, behind a million newer messages of other brains, took 570 ms that way. Each statement therefore matches its key with `= ANY` of a list that holds the key alone, and orders by the key before the transaction id and the position. A list does not make the key a constant to the planner, so ordering by the key is no longer redundant, and the only index that yields that order without a sort is the ledger's own. The same page then took 1.5 ms, and every page of [Measurement](#measurement) behind those million messages costs what it costs before them. SQLite's planner, without statistics, takes the index on the key for an equality, and the SQLite read matches with `=`.

### Order, and the horizon on PostgreSQL

On SQLite appends are serialised, so global positions follow commits, and the read orders by position.

On PostgreSQL a message takes its global position when it is inserted and becomes visible when its transaction commits, so a later position can be visible before an earlier one. The read therefore orders by transaction id, then global position, as Emmett's own batch read does: `readMessagesBatchSQL` in `@event-driven-io/emmett-postgresql` 0.43.0-beta.50, `dist/index.js` lines 1274 to 1289, orders at line 1287, `ORDER BY transaction_id, global_position`, and reads behind a horizon at line 1285, `AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())`.

The ledger keeps that horizon where it is needed, and narrows it:

- **Oldest first**, a reader follows the tail and goes on from its last record, so a message committed late below that record would be skipped for good. These reads stay behind the horizon: a message whose transaction is still open, and every message after it in the order, waits until that transaction ends, then comes in the next page, once.
- **Newest first**, a read pages downward from a position, and a message committed late appears in its next fresh read, so these reads keep no horizon and show every committed message.
- **The horizon is the ledger's own database's.** Transaction ids belong to the whole PostgreSQL server, and `pg_snapshot_xmin` is the oldest transaction open anywhere on it, so an idle write in another database would hide the newest messages of every ledger on the server for as long as it stays open. The ledger instead takes the oldest id among the transactions the read's own snapshot sees in progress, `pg_snapshot_xip(pg_current_snapshot())`, leaving out the ids that `pg_stat_activity.backend_xid` shows writing in another database. An id that is in doubt stays in: one whose transaction ended between the snapshot and the lookup, or one a role may not see in `pg_stat_activity`. A transaction holds an id once it first writes, so a transaction that has only read holds nothing back, which a probe confirmed.

The read never waits for the horizon: it answers at once with what lies below it. A reader that reaches the newest end oldest first, while a write of the ledger's database is open, cannot tell a quiet brain from one held back.

### The cursor

A cursor is the base64url encoding, without padding, of a JSON array: the brain key and the position of a record on SQLite, such as `["brain/acme/sales/","1234"]`; the brain key, the transaction id and the position on PostgreSQL. Each record carries its own cursor, and `nextCursor` is the cursor of the last record the page examined. A cursor may hold one more part, a whole number, which points inside the record: a read from it begins with that record, in either order, rather than after it, and leaves to the operation that presents the record which of its events to leave out. A cursor that is not such an array, holds a different number of parts than the store keeps, or holds a part that is not a decimal of at most 2^63 − 1 fails the read with `InvalidCursor` of kind `malformed`; one that is well formed but names another brain fails with kind `of_another_brain`. The brain-bound read turns either into `invalid_input` at `/cursor`, with a detail that says which. A cursor is not encrypted: whoever decodes it learns a position of the ledger.

### The version of a record, and a read of heads

Each record carries `version`, its position within its stream, read from Emmett's `stream_position`. A page given `dataOf` loads the data of the records of those types alone and measures the size of those alone: a statement measures a record it examines only when the page wants the record and loads its type, the bound of 4 MiB counts the sizes of the records it loads, and the statement that loads data asks only for their positions, so a page of heads, `dataOf: []`, measures nothing, examines up to its limit and loads nothing (`src/heads/heads-behaviour.ts`, on both stores and the in-memory ledger).

On PostgreSQL a size is `octet_length(message_data ->> 'json')`, which takes the data out of its TOAST table and decompresses it, so measuring a record costs about what loading it costs. `measure-heads.ts` measures the statement that examines a page with `EXPLAIN (ANALYZE, BUFFERS)`, over 20 records of 1,400,000 bytes of text that does not compress in one brain, 20 reads after 3 to warm:

```bash
LEDGER_MEASURE_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm --filter @beonauto/ledger measure:heads
```

| The page                                                          | Measuring every record it examines | Measuring the records it loads |
| ----------------------------------------------------------------- | ---------------------------------- | ------------------------------ |
| a page of heads, `dataOf: []`                                     | 3,598 buffers, 29.6 ms             | 1 buffer, 0.40 ms              |
| the workflow host's follower, which loads the data of specs alone | 3,598 buffers, 30.4 ms             | 1 buffer, 0.20 ms              |
| every record with its data                                        | 3,598 buffers, 28.1 ms             | 3,598 buffers, 17.8 ms         |

The times are medians, measured on 2026-10-06 on the machine and with the PostgreSQL of [Measurement](#measurement), while the machine ran other work at a load average of about 105, so they are higher than an idle machine gives and vary from one run to the next; the buffers, the pages of 8 KiB the statement touched, do not depend on the load. On SQLite `octet_length(message_data)` reads the length alone, as [The bounds of a page](#the-bounds-of-a-page) says, and the statement measures the same records.

### The bounds of a page

A page examines records in order and ends at the first of its bounds, with `nextCursor`:

- `limit`, 1 to 100 records answered: without a filter of types, the page examines that many; with one, it examines up to 1,000 records, or 1,000 runs for a list of runs filtered by the type of their latest message, and answers those of its types, possibly none.
- 4 MiB of data loaded, counted from the length of the stored JSON of each record the page loads, before any is loaded: `octet_length(message_data)` on SQLite, which reads the length alone, and `octet_length(message_data ->> 'json')` on PostgreSQL, the text inside the wrapper, so no SQL parses an event's own JSON. The first record a page wants is always loaded, so a record larger than the bound ends a page of its own.

A page takes at most three statements: when `since` is given, one that finds where the page starts; one that examines the page without loading data; and one that loads the data of the records it delivers, by position. Every statement binds at most 15 parameters, far below the 100 a hosted SQLite takes; SQLite takes each list, of stored types or positions, as one JSON parameter through `json_each`. None needs a transaction.

### Times and data

`recordedAt` is the time the store recorded a message: SQLite's `created`, `CURRENT_TIMESTAMP` in UTC to the second, given as `2026-10-05T09:00:00.000Z`; PostgreSQL's `created`, `now()`, the start of the append's transaction, to the millisecond. `since` finds the first message the brain recorded at or after it, by recorded time then position, through the second index; the page starts there oldest first and ends there newest first. SQLite rounds `since` down to the second, so a page from a time may begin with messages of the same second recorded just before it.

The data of a record is decoded as the store's `read` decodes it: on SQLite the stored JSON text, parsed as Emmett's serializer parses it, and on PostgreSQL the `{"json": …}` wrapper, read back by the same `dataAsJsonText`. An event that holds U+0000 is read like any other.

### Measurement

`measure.ts` at the root of this package records these numbers again, writing the data of `measure/dataset.ts`. The dataset is also the subpath `@beonauto/ledger/dataset`, so the measurement of the outcomes in `@beonauto/specs` fills from the same ledger (see [Measurement of the outcomes](#measurement-of-the-outcomes)):

```bash
LEDGER_MEASURE_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm --filter @beonauto/ledger measure
```

It fills a temporary SQLite file and, when `LEDGER_MEASURE_POSTGRESQL_URL` names a server, a database of its own there, which it drops afterwards; without it, it measures SQLite alone. `LEDGER_MEASURE_RUNS` sets the runs, 100,000 when left out and at least 50,016, since the deep pages start from run 50,000. It prints the time the ledger took to open and build its indexes, and a table of pages.

Measured on 2026-10-06 on an Apple M4 Max, with Node 26.10, SQLite 3.52.0 through `sqlite3` 6.0.1 on a file, and PostgreSQL 18.6, the image CI uses, in a local container with its default settings (128 MB of shared buffers).

The ledger held 1,197,287 messages. One brain held 497,287 of them: 100,000 runs, each its start and, but for the 2,714 still running, its finish (87,286 succeeded, 5,000 rejected, 4,000 deferred, 1,000 failed), and for every tenth run a run log of 20 inputs of 2 KiB; and one more run, still running, whose run log took an input with each of the others, so that its two streams hold 100,001 messages. Every message of a run carries the run as its correlation, so the tree of each run is the run alone. 99 other brains held the other 700,000. Every 200th run, 500 in all, took an input of 256 KiB and an output of 1 MiB of text that does not compress; the others an input of 320 bytes and an output of 640. The command opened the ledger on an empty database, dropped its five indexes, and inserted the messages with SQL, one run at a time and on PostgreSQL in a transaction each, followed by `VACUUM ANALYZE`; then it opened the ledger again, which built the indexes, in 4.2 s on SQLite and 6.1 s on PostgreSQL, where it then analysed the table, and read. Last, other brains wrote a million messages in one statement, the newest of the ledger, PostgreSQL's table was analysed again, as autovacuum would, and the command read three pages of the brain newest first once more, and a page of the tree of a run in each order. A deep page starts from the first message of run 50,000, a time from the moment that run started.

Each page was read through `Ledger.readRecorded`, 20 records or runs to a page unless the table says 100, three times to warm and then 20 times. The table gives the median and the slowest of the 20 in milliseconds, the records the page answered, a run answering its first and its latest message, and the data they held as SQLite answered them, a little less than PostgreSQL's, whose cursors are longer.

| Page                                                                                            | SQLite, median (slowest) | PostgreSQL, median (slowest) | Records | Data     |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------- | ------- | -------- |
| The brain, first page, newest first                                                             | 0.36 (0.55)              | 1.32 (1.58)                  | 20      | 13 KiB   |
| The brain, first page, oldest first                                                             | 0.34 (0.54)              | 2.02 (2.17)                  | 20      | 43 KiB   |
| The brain, deep page, newest first                                                              | 0.32 (0.39)              | 1.36 (1.47)                  | 20      | 12 KiB   |
| The brain, deep page, oldest first                                                              | 0.37 (0.90)              | 2.11 (2.28)                  | 20      | 44 KiB   |
| The brain, deep page of 100, newest first                                                       | 0.90 (1.74)              | 2.62 (3.64)                  | 100     | 126 KiB  |
| The brain, a page holding a run of 1.25 MiB                                                     | 1.20 (3.91)              | 8.95 (9.66)                  | 20      | 1303 KiB |
| The brain, of one rare type, newest first                                                       | 0.93 (1.07)              | 2.36 (2.55)                  | 2       | 1 KiB    |
| The brain since a time, oldest first                                                            | 0.37 (0.48)              | 2.32 (2.61)                  | 20      | 42 KiB   |
| The brain since a time, newest first                                                            | 0.35 (0.42)              | 1.59 (1.66)                  | 20      | 13 KiB   |
| One run of 21 messages, oldest first                                                            | 0.33 (0.71)              | 2.30 (2.42)                  | 20      | 43 KiB   |
| One run of 21 messages, newest first                                                            | 0.31 (0.36)              | 1.56 (1.70)                  | 20      | 44 KiB   |
| A run of 100,001 messages, first page, oldest first                                             | 0.29 (0.33)              | 1.94 (2.15)                  | 20      | 5 KiB    |
| A run of 100,001 messages, first page, newest first                                             | 0.28 (0.33)              | 1.21 (1.32)                  | 20      | 5 KiB    |
| A run of 100,001 messages, from its middle, oldest first                                        | 0.31 (0.85)              | 1.92 (2.03)                  | 20      | 5 KiB    |
| A run of 100,001 messages, from its middle, newest first                                        | 0.32 (0.39)              | 1.60 (2.04)                  | 20      | 5 KiB    |
| The tree of a run of 21 messages, oldest first                                                  | 0.29 (0.34)              | 2.04 (2.22)                  | 20      | 43 KiB   |
| The tree of a run of 21 messages, newest first                                                  | 0.28 (0.31)              | 1.99 (2.40)                  | 20      | 44 KiB   |
| The tree of a run of 100,001 messages, from its middle, oldest first                            | 0.26 (0.79)              | 2.19 (2.33)                  | 20      | 5 KiB    |
| The tree of a run of 100,001 messages, from its middle, newest first                            | 0.26 (0.28)              | 1.44 (1.75)                  | 20      | 5 KiB    |
| Runs, first page, newest first                                                                  | 0.42 (0.49)              | 1.81 (2.26)                  | 38      | 30 KiB   |
| Runs, first page, oldest first                                                                  | 1.17 (1.96)              | 8.97 (10.10)                 | 38      | 1308 KiB |
| Runs, deep page, newest first                                                                   | 0.44 (0.51)              | 1.55 (1.80)                  | 39      | 31 KiB   |
| Runs, deep page, oldest first                                                                   | 1.28 (4.82)              | 9.20 (11.57)                 | 40      | 1310 KiB |
| Runs, deep page of 100, newest first                                                            | 1.48 (2.15)              | 3.05 (3.23)                  | 197     | 155 KiB  |
| Runs that succeeded, newest first                                                               | 3.20 (4.00)              | 2.96 (3.33)                  | 40      | 33 KiB   |
| Runs that succeeded, deep page, oldest first                                                    | 4.18 (4.79)              | 10.98 (12.48)                | 40      | 1312 KiB |
| Runs that failed, newest first                                                                  | 3.33 (3.86)              | 4.04 (4.22)                  | 20      | 10 KiB   |
| Runs that failed, deep page, oldest first                                                       | 3.15 (3.48)              | 4.65 (5.93)                  | 20      | 10 KiB   |
| Runs of a status none has, 1,000 examined                                                       | 2.99 (3.27)              | 3.54 (3.72)                  | 0       | 0 KiB    |
| The brain, newest first, behind a million newer messages of other brains                        | 0.22 (0.33)              | 1.48 (1.95)                  | 20      | 13 KiB   |
| Runs, newest first, behind a million newer messages of other brains                             | 0.40 (2.09)              | 1.82 (2.84)                  | 38      | 30 KiB   |
| A run of 100,001 messages, newest first, behind a million newer messages of other brains        | 0.27 (0.39)              | 1.26 (1.39)                  | 20      | 5 KiB    |
| The tree of a run of 21 messages, oldest first, behind a million newer messages of other brains | 0.31 (0.38)              | 1.81 (2.08)                  | 20      | 43 KiB   |
| The tree of a run of 21 messages, newest first, behind a million newer messages of other brains | 0.26 (0.33)              | 1.52 (1.72)                  | 20      | 44 KiB   |

Every page, unfiltered or filtered by status, answered within 11 ms at the median and 13 ms at the slowest, under the bar of 50 ms this ledger set itself for staying without a read model ([decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md)). The slowest pages are those that load a run of 1.25 MiB; a page of runs filtered by status examines up to 1,000 runs, which SQLite does all at once and PostgreSQL only until the page is full.

## The outcomes of runs

`Ledger.readRunOutcomes(brain, window, selection)`, the read the `Ledger` port of `@beonauto/operations` describes, is answered from a table the ledger keeps inside the appends of the run streams, one row per run. What a row holds comes from the run outcome mapping the ledger is opened with, which the package that owns the run events, `@beonauto/specs`, supplies at composition: `ledgerLayer({ fileName, runOutcomes })` and `postgresqlLedgerLayer({ connectionString, runOutcomes })`. The ledger knows the streams of runs, named `<brain key>executions/<id>` (see [The brain key](#the-brain-key)), and nothing of their events.

### Inline projections

An inline projection of Emmett 0.43.0-beta.50 handles the messages of an append inside the append's own transaction: on SQLite in the `onBeforeCommit` of the append, on PostgreSQL inside the transaction of `appendToStream`. It is handed the messages of the types it names, in their stored form, with their stream's name and position, and a projection that throws fails the append, which keeps nothing, the rows the projection changed included; a failed append runs no projection. On PostgreSQL Emmett skips a projection that has a name when it cannot take its advisory lock or its status is not active, so the ledger's projection has none and always runs. On both stores a unique-constraint error inside a projection would surface as a version conflict, retried three times and then `conflict` `concurrent_change`; the table has no constraint but its key and is written with an upsert, so it never raises one.

`src/outcomes/inline-projection.ts` is the facility: an `InlineProjection` names its stored types and handles the messages of an append, each `{ stream, type, data }`, with the executor of the append's transaction. The ledger registers one, over the run streams: for each of their messages it reads the run's row if there is one, decodes the message's data as the store's reads decode it, the JSON object as written on SQLite and the `{"json": …}` wrapper read back on PostgreSQL, gives both to the mapping, and writes the row it answers with an upsert keyed by the run, or nothing when it answers `undefined`. That is one read and one write in the append for each message of a run's event, and nothing for the messages of any other stream or type. The mapping must never throw.

A store opened without a mapping neither creates the table nor writes it, and its `readRunOutcomes` answers no groups rather than reading a table that may not be there, so every writer of a run stream must write through a store that carries the projection. Today that is the server's ledger, through which the workflow host settles runs too; the workflow host's own stores write only the logs of runs.

### The table

| Column                                                          | What it holds                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `brain_key`, `run_id`                                           | The brain key of the run's stream and its id, the table's only key                     |
| `started_day`, `started_at`, `last_started_at`                  | The day and time of the run's first start, and the time of its latest                  |
| `primitive`, `name`, `status`                                   | The run's definition and how it stands: `started`, `succeeded`, `failed` or `rejected` |
| `duration_ms`, `input_tokens`, `output_tokens`, `cached_tokens` | Its duration and the tokens it used, each null when unknown                            |

The table is `run_outcomes_1`, with the index `run_outcomes_1_by_brain_and_day` on `(brain_key, started_day)`. Days and times are text, `YYYY-MM-DD` and ISO 8601, so that the two stores compare them alike; the numbers are `INTEGER` on SQLite and `bigint` on PostgreSQL. The columns are the ledger's; their meaning is the mapping's, which `@beonauto/specs` documents.

### Creating and filling it

When the ledger opens with a mapping, it looks the table up by name in the catalog, as it does its indexes, and does nothing more when it finds it. When it does not, it creates the table and its index, fills it by replaying every run stream of the store, drops the tables of earlier versions, `run_outcomes_0` and below, and analyses the new one, all in one transaction, so that a fill that is interrupted, by a mapping that throws or a process that stops, leaves nothing behind and is done again at the next open. On SQLite this runs after Emmett's migration and the indexes, on the same connections; on PostgreSQL in `onAfterSchemaCreated`, inside the migration's transaction and under its advisory lock, so that servers that start together fill the table once. Emmett's migrator waits 10 s for that lock, `defaultDatabaseLockOptions` in `@event-driven-io/dumbo` 0.13.0-beta.56, `dist/pg.js` line 673, less than the fill of a large ledger takes, and the typed options of Emmett's store and of its `schema.migrate()` offer no longer wait. So the ledger takes the same lock first, in `onBeforeSchemaCreated`, inside the migration's transaction (`migrationLockTakenWithin` in `src/postgresql/postgresql-run-outcomes.ts`): it tries `pg_try_advisory_xact_lock` every 100 ms for up to 60 s, past the longest fill measured below, 42.7 s, and once it has the lock holds it through the migration and the fill until the transaction commits; the migrator, in the same transaction, takes it again at once. A server that starts while another fills a large ledger waits for it, and stops at start, saying why, only when the lock is still held after 60 s.

No index lists the run streams across brains, so the fill scans the store's streams, `emt_streams`, for the names of run streams in the order of their names, with the size of their messages of the mapping's types, and takes of them as many as hold at most 16 MiB of those messages, at least one, so that a ledger of records of 1 MiB does not hold hundreds of megabytes at once. It lists as many streams as the batch before showed fit: one at first, then as many as 16 MiB holds at the bytes per stream of the streams the batch before took, at most twice as many as it listed before and at most 100. On PostgreSQL the size is the length of each record's text, which reads the record, so listing 100 streams of records of 1 MiB would read 100 MiB to load 16 MiB; listed this way, the fill sizes about as many bytes as it loads. For each batch it reads, in one statement, those messages in their order, decodes each as the store's reads do, folds the messages of each stream through the mapping, and writes the rows in upserts of 8 on SQLite, within the 100 parameters of a hosted SQLite, and of 500 on PostgreSQL. A change to what the table keeps is a new version, `run_outcomes_2`, which the next server fills this way and whose fill drops `run_outcomes_1`. Servers of different versions do not share a database at once.

### Reading it

The read answers, in one statement over the index, the rows of the brain whose `started_day` lies in the window, with the selection's `primitive` and `name`, grouped by day, primitive, name and status: each group with its count, its token sums, `coalesce(sum(…), 0)`, and the durations that are not null as a JSON array, `json_group_array(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)` on SQLite and `json_agg` with the same filter on PostgreSQL. The brain key is matched with `=`, and the statement binds five parameters at most.

### Measurement of the outcomes

`measure-outcomes.ts` in the `measure` folder of `@beonauto/specs` records these numbers again, writing the data of `measure/outcomes-dataset.ts` there and, for the fill, this package's `measure/dataset.ts`, through `@beonauto/ledger/dataset`. It lives with `runOutcomeMapping`, the mapping it opens the ledger with, so that this package depends on specs for nothing, not even a script:

```bash
LEDGER_MEASURE_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm --filter @beonauto/specs measure:outcomes
```

`LEDGER_MEASURE_OUTCOME_RUNS` sets the sizes, `10000,100000` when left out, and `LEDGER_MEASURE_FILL_TICKS` the ticks of the ledger the fill replays, 100,000 when left out. `LEDGER_MEASURE_PARTS` picks what it measures, `read,append,fill,large-fill` when left out.

Measured on 2026-10-06 on an Apple M4 Max, with Node 26.10, the ledger on SQLite 3.52.0 through `sqlite3` 6.0.1 on a file, and PostgreSQL 18.6 in a local container with its default settings, as [Measurement](#measurement) was; the data is written with SQL, on SQLite through `node:sqlite` (SQLite 3.53.4), and the aggregate over the records below runs there too.

**The read.** A brain holds N runs over 30 days, each a start and a finish: one in 20 rejected with a record of its usage, one in 33 failed, the others succeeded with a record of 64 KiB that holds their usage, spread over 20 functions; another brain holds N/10 more. The ledger opens on that data, so it fills the table, and `Ledger.readRunOutcomes` reads the 30 days of the first brain, three times to warm and then 20 times. The alternative the read replaces, an SQL aggregate at request time over the stored records, the first message of each run and its latest, read out of their JSON, is timed once to warm and then three times. Times are the median and the slowest, in milliseconds.

| Store      | Runs in the window | The read    | The aggregate over the records | Open and fill |
| ---------- | ------------------ | ----------- | ------------------------------ | ------------- |
| SQLite     | 10,000             | 5.87 (6.11) | 1,613 (2,322)                  | 0.69 s        |
| PostgreSQL | 10,000             | 6.28 (6.69) | 117 (118)                      | 4.31 s        |
| SQLite     | 100,000            | 107 (111)   | 13,850 (13,974)                | 7.59 s        |
| PostgreSQL | 100,000            | 58.7 (62.6) | 888 (895)                      | 42.7 s        |

The read and the open and fill of SQLite at 10,000 runs were measured again on a quiet machine, since the first run of that row was under load; two quiet runs agreed within a tenth of a millisecond and a few hundredths of a second. The aggregate in that row and the other rows are from the first measurement.

The read grows with the runs of the window, since it reads one row of the table for each, and crosses the bar of 50 ms a page that [decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) set at about 49,000 runs in a window on SQLite and 85,000 on PostgreSQL, by the line between the two sizes. A rollup per day is the next step for a window that holds more than about 50,000 runs, as that of a brain that runs that often in 30 days, or a longer window. The aggregate over the records costs 15 to 275 times the read, since it parses every record.

**The append.** 1,000 runs each append their start and then their finish, with a record of 2 KiB, one append at a time, to a ledger opened without the projection and to one opened with it. Times are the median and the 95th percentile of the 2,000 appends, in milliseconds:

| Store      | Without the projection | With it     |
| ---------- | ---------------------- | ----------- |
| SQLite     | 0.27 (0.41)            | 0.35 (0.41) |
| PostgreSQL | 1.34 (1.65)            | 1.81 (2.25) |

**The fill.** The ledger of [Measurement](#measurement), 1,197,287 messages of which about 800,000 run streams, written without the table and opened with the mapping: the open that fills the table took 6.69 s on SQLite and 29.3 s on PostgreSQL, against 0.01 s and 0.02 s for an open that finds it. That is the start of the first server of this version on such a ledger; on PostgreSQL a second server started meanwhile waits for the migration lock, up to 60 s, and goes on once the fill is done. Every number of this section was measured on Node 26.10. Those of this fill and of the open and fill in the read were measured with the fill that listed 100 streams for each batch; on those ledgers 100 streams hold less than 16 MiB, so the fill as it is lists 100 streams from its eighth batch on and reads what that fill read.

**The fill of large records.** 300 runs of one brain, each a start and a finish, 276 of them succeeded with a record of 1 MiB and the other 24 rejected or failed with a finish of less than 1 KiB, written without the table and opened with the mapping, by the fill that listed 100 streams for each batch and by the fill as it is. The record pages are the pages of the TOAST table of `emt_messages` that PostgreSQL read during the open, from `pg_statio_user_tables`, the same at every run. The machine was busy throughout, at a load of 100 to 140 on 16 cores, so the times are the fastest and the slowest of 10 runs of the first fill and 9 of the second.

| Store      | The fill            | Record pages read | Open and fill, fastest (slowest) |
| ---------- | ------------------- | ----------------- | -------------------------------- |
| SQLite     | Listing 100 streams |                   | 0.44 s (3.87 s)                  |
| SQLite     | As it is            |                   | 0.26 s (3.34 s)                  |
| PostgreSQL | Listing 100 streams | 1,793 MiB         | 2.27 s (9.52 s)                  |
| PostgreSQL | As it is            | 586 MiB           | 1.70 s (8.69 s)                  |

The pages read fall from 6.5 times the 276 MiB of records the fill loads to 2.1 times. With `log_min_duration_statement = 0` on the server, four runs of each fill, the 19 listings of the first fill took 0.88 to 1.35 s and the 22 of the fill as it is 0.34 to 0.46 s, against 0.53 to 0.65 s for the loads of either fill in two runs of each, and 2.2 to 3.5 s in the other two, which is where the slowest times above come from: the listings now cost less than the loads they size. SQLite reads the length of a record from its header, not its text: `octet_length` over 300 records of 1 MiB took 0.24 ms through `sqlite3` 6.0.1, against 69 ms over the same text joined to an empty string, so on SQLite the two fills read the same records and differ only in the number of their listings.

## The signal of an append

`emmettEventStore` raises `streamAppends`, a `StreamSignal` of the process, after each append it made, with the name of the stream, and raises nothing for an append that met a version conflict. Every store of the process appends through it, the ledger's layer and the workflow host's own store alike, so a listener, `streamAppends.listen(listener)`, which answers the function that stops it, hears every append the process makes, a few microseconds after it commits. A listener is called in the append's own call, after the commit, and must not throw. An append made by another process raises nothing here; a reader that must see those reads the ledger anyway. `streamSignalOf()` makes a signal of one's own, for a test, and `emmettEventStore` takes it as `appended`. It is apart from `appendSignal`: that one tells the brain key of an append and is raised only by a layer given it, while `streamAppends` tells every stream, a brain's or not, and every store of the process raises it, so the workflow host's follower hears the appends to the registries of brains too.

## The streams appended to

`EventStore.readAppended(after, most)` answers which streams were appended to after a point, for a reader that must see the appends of other processes without reading each brain in turn. It reads up to `most` messages after `after`, oldest first, and answers the stream of each named through its fourth `/`, so the streams of one kind in a brain, such as `brain/acme/sales/events/`, count once, or by its whole name when it has fewer, such as `org/acme/brains`; `through`, the point the next read goes on from; and `more`, when it stopped at `most`. Without a point it reads nothing and answers the point a read from now goes on from. It reads no data.

On SQLite it walks the table's key, `global_position`, and goes on from the last message it read. On PostgreSQL it walks Emmett's index on `(transaction_id, global_position)` behind the horizon, as a page read oldest first does (see [Order, and the horizon on PostgreSQL](#order-and-the-horizon-on-postgresql)), so a message whose transaction is still open comes in a later read, once; when it read everything behind the horizon it goes on from the horizon itself rather than from its last message, so a read that finds nothing new starts past every message it read before. Measured with `EXPLAIN (ANALYZE, BUFFERS)` on PostgreSQL 18.6, on a table of 200,000 messages, a read that found nothing new walked that index and touched 3 buffers in 0.16 ms, and a read that found 10 new messages 5 buffers in 0.30 ms.

## Creating the layer

Each database has an entry of its own, so that code which never uses a database does not load its driver.

```ts
import { ledgerLayer } from '@beonauto/ledger/sqlite3';

const layer = ledgerLayer({ fileName: '/data/ledger.db' });
```

`runOutcomes`, optional on both layers, is the run outcome mapping the ledger keeps the outcomes of runs with (see [The outcomes of runs](#the-outcomes-of-runs)); the server gives the one of `@beonauto/specs`. Building the layer creates the directory of the database file if it is missing, then opens the database and migrates its tables before the ledger is ready; a directory that cannot be created or a database that cannot be opened is a defect at that point. Disposing the runtime closes every connection. `fileName: ':memory:'` gives a private in-memory database.

Each SQLite connection may cache up to 8 MiB of pages and maps none of the file into memory, where the driver's defaults allow about 1 GB of cache and 256 MiB of mapped file per connection. Every connection, the tests' temporary files included, runs in WAL mode with `synchronous=NORMAL`, the defaults of Emmett's connection layer, dumbo: a committed append survives a crash of the process, and only the latest commits can be lost if the machine loses power, since in that mode SQLite syncs the file at each checkpoint rather than at each commit. Measured on 2026-10-05 on an Apple M4 Max through `sqlite3` 6.0.1, an append of one event of 1.8 KB to a temporary file took 0.20 to 0.23 ms at the median with either setting, since macOS syncs only to the drive's cache; with `fullfsync` on, so that each sync reaches the drive as on a disk that honours syncs, it took 5.9 ms with `FULL` and 0.20 to 0.24 ms with `NORMAL`, whose syncs at checkpoints showed as 5.2 ms at p99.

```ts
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';

const layer = postgresqlLedgerLayer({ connectionString: 'postgresql://brains:<password>@db.internal:5432/brains' });
```

Building the layer connects to the database and creates or migrates Emmett's tables, functions and sequence in its `public` schema, the way Emmett documents it (`schema.migrate()` with automatic migration off), before the ledger is ready. A database that cannot be reached is a defect at that point, and its message names the host and port, never the password. Emmett's migrator holds an advisory lock on the database while it migrates, so servers that start together on an empty database migrate it once; the ledger takes that lock first and waits for it up to 60 s (see [Creating and filling it](#creating-and-filling-it)). The connections come from `pg`, the pure-JavaScript driver, through one pool for each ledger, of at most 10 connections, `pg`'s default; disposing the runtime ends the pool. When the database ends a connection, as a restart, a failover or `pg_terminate_backend` does, the ledger logs a warning with the database's message and the pool opens another connection on the next call; the server never stops for it.

The database's user needs `CREATE` on the `public` schema at every start, not only the first: the ledger migrates at every start, and the migrator runs `CREATE TABLE IF NOT EXISTS` on its own table, which PostgreSQL checks for the privilege before it looks whether the table exists, so a user that may only read and write the tables fails to start with `permission denied for schema public`. It also needs to read and write the ledger's tables, and to create its functions and sequence on an empty database.

## PostgreSQL

The ledger on PostgreSQL behaves as it does on SQLite; one suite of tests runs against both (see [Testing](#testing)). What was verified on Emmett's PostgreSQL store, `@event-driven-io/emmett-postgresql` 0.43.0-beta.50 with `pg` 8.23.1 against PostgreSQL 18.6:

- **An append is atomic.** Emmett appends every event of a call in one transaction, through one call of its function `emt_append_to_stream`; an append whose third event PostgreSQL refused left the stream as it was.
- **The expected version is checked exactly.** Expecting 0 of a stream that exists, a version beyond the stream's or one behind it, or any version but 0 of a stream nobody wrote, meets a version conflict and appends nothing. Of eight writers expecting the same version at once, one appended and seven met a conflict, for an existing stream and for a new one.
- **`STREAM_DOES_NOT_EXIST` is no check at all,** as on SQLite: Emmett turns it, `STREAM_EXISTS` and `NO_CONCURRENCY_CHECK` into no expected version and appends at the end. The ledger therefore always appends with a number.
- **A read from a version is exact.** Reading after version 3 of a stream at 5 gives events 4 and 5 and the version 5; past the end, Emmett gives no events and version 0, which `read` answers with the version asked after.
- **Message ids are not deduplicated.** The store keeps two events with the same message id, and the same event appended twice is two events with two ids.
- **The store keeps no JSON as written.** Emmett stores `data` in a `jsonb` column, and `jsonb` refuses the character U+0000 and unpaired surrogates and puts the keys of every object in its own order. The PostgreSQL entry therefore keeps each event's JSON text in that column, as `{"json": "<the event as JSON>"}`, so an event comes back exactly as it was decided, as it does from SQLite's text column. This is a deliberate trade: an exact round trip of tenant data matters more than `jsonb`'s operators. What an operator gives up is querying and indexing events by their fields in SQL: reading one takes `(message_data->>'json')::jsonb`, which fails for an event that holds U+0000, and an expression index over event fields would have to parse the text the same way. A stream name cannot hold U+0000 on PostgreSQL; the application layer's stream names are made of ids that never do.

An append on PostgreSQL binds ten parameters whatever the number of events, one array per column, so PostgreSQL's own limit of 65,535 parameters in one statement never binds. The ledger still bounds a decision, at 64 events, eight times SQLite's eight, so that a decider that runs away is a defect rather than one long transaction. Code that must run on both stores keeps its decisions to eight events.

Every command is a decision appended under an expected version, so concurrent writers never lose an update to brains and specs. Every server runs a workflow host, and one of them runs the database's workflows at a time, under a claim the workflow host keeps in its own table, so several servers may share the database.

## Portability

The same ledger is meant to run on other stores, such as the hosted runtime's SQLite databases, which bind at most 100 parameters in one statement. What it asks of a store comes in two parts.

What every store must provide, for the ledger to run at all:

- The event store's own operations, to read a stream or its tail after a version, append with an expected version, migrate and close. A command makes at most one append and needs no transaction of its own.
- The read of what a brain recorded, with the indexes the ledger creates when it opens; each statement binds at most 15 parameters, and none needs a transaction.
- An append on SQLite carries at most eight events: Emmett binds ten parameters for each event it inserts, and such a database binds at most 100 in one statement.
- A SQLite database must provide what the reads use: `octet_length` (SQLite 3.43 and later), window functions (3.25 and later), the JSON functions, of which the reads use `json_each` and `json_group_array` (built in since 3.38), and partial and expression indexes (3.8 and 3.9).
- No adapter or application may nest a stream under `executions/` within a brain: the key of a stream's kind ends at the fourth `/`, so the list of runs would take any stream named `executions/<id>/…` for a run.
- Only the entries `src/sqlite3.ts` and `src/postgresql/postgresql-ledger.ts` know which driver is in use; the main entry loads neither `sqlite3` nor `pg`.

What a store must provide besides, to keep the outcomes of runs that a brain's analytics read:

- Inline projections inside the append's own transaction: a read and an upsert of a run's row for each message of a run's event, which commit with the append and fail it when they fail. An upsert of one row binds 12 parameters, and SQLite must provide the upsert (3.24) and the `FILTER` of an aggregate (3.30).
- A transaction for the fill when the table is created, in which the store's streams are read and the rows written, 8 to an upsert of 96 parameters on SQLite, so that an interrupted fill leaves nothing behind.

A runtime whose store cannot provide both does not keep the table and does not offer the analytics of a brain until it can: it opens the ledger without the run outcome mapping, which neither creates nor writes the table, and leaves `get_brain_analytics` out of its catalog. That is the hosted runtime's case while its databases offer no interactive transactions: like tool access, which the hosted runtime does not offer yet, the analytics of a brain come there once its store provides what they need.

## Testing

The ledger's behaviour is one suite, in `src/testing/ledger-behaviour.ts`, that `src/ledger.test.ts` runs on SQLite and `src/postgresql/ledger-on-postgresql.test.ts` runs on PostgreSQL. Its part on the outcomes of runs, `src/outcomes/run-outcomes-behaviour.ts`, also runs on the in-memory ledger, in `src/outcomes/run-outcomes-in-memory.test.ts`, with the `runTallies` mapping of `@beonauto/operations/testing`; `src/outcomes/run-outcome-table-behaviour.ts` holds what only a store does: an append whose projection throws, of which nothing is kept, a ledger opened without the projection, a table filled at open, an interrupted fill done again, and a table found and not filled again. That ledgers that start together fill the table once is tested on PostgreSQL alone, in `src/outcomes/run-outcomes-on-postgresql.test.ts`. That a server waits past the migrator's 10 s for a migration lock another server holds is tested with a fake lock and a fake clock in `src/postgresql/postgresql-run-outcomes.test.ts`, and on PostgreSQL in `src/postgresql/connections-on-postgresql.test.ts`, where a client holds the lock for 12 s. The server tests the mapping of `@beonauto/specs` on both stores, through the ledger it composes. Its part on reading what a brain recorded, `src/testing/recorded-behaviour.ts`, `src/testing/runs-behaviour.ts`, `src/lineage/lineage-behaviour.ts` and `src/heads/heads-behaviour.ts`, the ids, causes and correlations a read gives, the read by correlation, the read from inside a record, and the versions and the read of heads, also runs on the in-memory ledger of `@beonauto/operations`, in `src/recorded/recorded-in-memory.test.ts`, so the three agree. A read behind an append whose transaction is still open, the same read by correlation, the same read newest first, a list of runs oldest first behind such an append, a write open in another database that hides nothing, and a start that finds the indexes while an append is open are tested on PostgreSQL alone, since SQLite serialises appends. Before each read of what a brain recorded, the PostgreSQL entry of the suite waits until every committed message of its own database is older than every write open on the server, polling every 20 ms for at most 10 s and failing the test past that; the tests that wait have a timeout of 30 s, above vitest's 5 s. Waiting for the ledger's own horizon is not enough when other tests write on the same server: a write in another database that began before a message and ends while a read runs is in doubt to that read, which then stays behind it and may answer nothing, as a probe that ended such a write during a read confirmed. The test of a write open in another database waits for every write but that one. The SQLite entry and the in-memory ledger do not wait. `src/testing` holds 15 files, the most a folder holds, so the suite of lineage opened `src/lineage` and the suite of heads `src/heads`. `src/signal/append-signal.test.ts` tests the signal of an append on SQLite.

```bash
docker run --detach --name ledger-pg-test --publish 127.0.0.1:19632:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm check
docker rm --force ledger-pg-test
```

CI's Verify job runs it on every pull request against a PostgreSQL service container.
