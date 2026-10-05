# @beonauto/ledger

The ledger keeps track of every single action and interaction that the brain does. It is the log of the inputs and outputs to all the primitives.

This package is the event store behind the `Ledger` port of `@beonauto/operations`. It stores events with [Emmett](https://event-driven-io.github.io/emmett/) on SQLite or on PostgreSQL.

## What it stores

- **Streams of events.** The application layer names each stream, for example `org/acme/brains` or `brain/acme/sales/specs/inference`. Names are opaque: the ledger never changes their case, trims them or normalises their Unicode, so two names that differ in any character are two streams.
- **One version per stream.** A stream's version is the number of events in it, and 0 when nobody has written it.
- **Events as Emmett stores them.** Each event becomes `{ type, data }`. `type` is the event's own `type`. `data` is the whole event encoded with `Schema.toCodecJson(decider.eventSchema)`, which must give a JSON object. Loading decodes `data` with the same codec, so an event comes back exactly as it was decided, dates and big integers included. A stored event that no longer decodes is a defect.

## How a command runs

`execute(stream, decider, command)` loads the stream, folds its events with `decider.evolve`, and asks `decider.decide`.

- A rejection is returned as it is, and nothing is appended.
- A decision of no events appends nothing and answers with the current state and version.
- Otherwise the events are appended with the version that was read as the expected version. If another writer appended first, the append meets a version conflict: the stream is loaded and the command decided again, up to three more times, and then it fails with `Conflict`. Like the in-memory ledger of `@beonauto/operations`, its detail names no stream.
- A decision of more events than the store takes in one append is a defect: eight on SQLite, 64 on PostgreSQL.
- Any other failure of the database is a defect, never a `Conflict` or a rejection.

## Building on the ledger's loop

Code that keeps its own streams, such as `@beonauto/workflow-engine`, uses the same pieces as the ledger itself rather than a copy of them:

- `sqliteEventStore(optionsOf)` opens the event store on any of Emmett's SQLite drivers, without the layer, and `postgresqlEventStore({ connectionString, reportLostConnection })` from `@beonauto/ledger/postgresql` opens it on PostgreSQL. Both are one adapter over an Emmett event store, `emmettEventStore`, given how each keeps an event's data and how many events it takes in one append, beside the store's own read of what a brain recorded, `EventStore.readRecorded` (see [Reading what a brain recorded](#reading-what-a-brain-recorded)).
- `EventStore.read(stream, after)` gives the events after version `after` and the version of the whole stream, so a reader that holds a snapshot at version `after` reads only the tail. Emmett answers a read past the end of a stream with version 0; `read` answers with `after` instead.
- `EventStore.mostEventsInOneAppend` is the most events the store takes in one append.
- `eventAppenderOf(store)` encodes and appends events with an expected version, at most `store.mostEventsInOneAppend` in one append, and fails with `VersionConflict` when another writer appended first.
- `retriedOnVersionConflict(attempt)` runs a load-decide-append attempt again after a version conflict, up to three more times, and then fails with `Conflict`.
- `decisionLoop(load, append, decider)` is the load-decide-append loop itself, the one `Ledger.execute` runs: it loads, decides, appends the decided events with the loaded version expected, retries with `retriedOnVersionConflict`, and answers with what the load gave, the events and the folded state. The ledger's load folds the whole stream; a caller with snapshots passes a load that folds a snapshot and its tail.

## Reading what a brain recorded

`Ledger.readRecorded(brain, selection, page)`, the read the `Ledger` port of `@beonauto/operations` describes, is answered by the store: one SQL read of its own on each store, over Emmett's messages table, with four indexes the ledger adds to it. The selections, the page and its bounds are the port's; this section says how each store answers them. [Decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) records why the read is a read of the ledger and how it was measured.

### The brain key

Every stream of a brain is named `brain/<org>/<brain>/…`. The store takes the key of a message's stream, its name through the third `/`, with an expression, and compares it to the brain's key, `brain/<org>/<brain>/`, for equality: with `=` on SQLite, and on PostgreSQL with `= ANY` of a list that holds the key alone, for the reason [How PostgreSQL reaches the indexes](#how-postgresql-reaches-the-indexes) gives. It never matches with `LIKE` or any pattern: org and brain ids may hold uppercase letters and `_`, SQLite's `LIKE` ignores case, and `_` matches any character in both stores. A stream name with fewer than three `/` has no key and belongs to no brain.

| Store      | The key of a stream                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| SQLite     | `substr(stream_id, 1, …)` to the third `/`, found with nested `instr`, since SQLite has no regular expressions |
| PostgreSQL | `substring(stream_id FROM '^(?:[^/]*/){3}')`, null for a name with fewer than three `/`                        |

The same expression taken to the fourth `/` gives the key of a stream's kind within its brain, such as `brain/acme/sales/executions/`. A run is a stream whose kind key ends in `executions/`, so no other stream may be nested under `executions/`.

### The indexes

| Index                               | SQLite                                                           | PostgreSQL                                                                | What reads it                                               |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ledger_messages_by_brain`          | brain key, position                                              | brain key, transaction id, position                                       | a brain's messages, in order, from any cursor               |
| `ledger_messages_by_brain_and_time` | brain key, recorded time                                         | brain key, recorded time, transaction id, position                        | where a page `since` a time starts                          |
| `ledger_messages_by_stream`         | stream, position                                                 | stream, transaction id, position                                          | one run's two streams, each in order from any cursor        |
| `ledger_first_messages_by_kind`     | kind key, position, first messages alone (`stream_position = 1`) | kind key, position in the stream, transaction id, position, every message | the runs of a brain, by the position of their first message |

The read of one run reads each of its two streams through the third index from the cursor on, and merges them, so a page of a run of 100,001 messages costs the same at its start and in its middle, in either order. Without it, SQLite read such a run through Emmett's unique index on the stream and its version and sorted what it read: on a file holding a run of 100,001 messages and 100,000 messages of other streams of its brain, a page took 24 ms at the start of the run newest first, 14 ms from its middle newest first and 4.7 ms from its middle oldest first, against 0.23 to 0.42 ms with the index.

The list of runs walks the fourth index through the first message of each run, so a page of runs costs the same however many messages the run logs of a brain hold between two runs. Without it, on a ledger of 598,362 messages, PostgreSQL estimated 845 first messages of runs where there were 60,000, and answered a page of runs filtered by status with a sequential scan of the whole table, in 122 to 126 ms; with it, the same pages took 1.4 to 3.5 ms. On SQLite the index holds the first messages alone. On PostgreSQL it holds every message, with its position in its stream as the second column, which the read asks to be 1, because the planner takes no statistics from the expression of an index with a `WHERE` clause: with the index partial, as on SQLite, on the ledger of [Measurement](#measurement), it planned a deep page of failed runs oldest first as a bitmap scan of the brain's runs and a sort of 49,999 of them, in 73 ms; whole, and with the table analysed, the same page took 4.4 ms.

The ledger creates the indexes when it opens, but first looks them up by name in the catalog, `pg_class` on PostgreSQL and `sqlite_master` on SQLite, which takes no lock on the messages table, and creates only those missing, with `CREATE INDEX IF NOT EXISTS`. A start that finds them all issues no `CREATE`. That matters on PostgreSQL, where `CREATE INDEX`, even on an index that exists, takes a lock on the messages table that waits for the appends in flight and holds every new append behind it: with an append left open for 2 s, `CREATE INDEX IF NOT EXISTS` on an index that existed took 2,013 ms, and an append begun 200 ms after it waited 1,821 ms; a start that looked first took 15 to 17 ms with the append still open, and a test checks that such a start is not held up. On PostgreSQL the lookup and the creation run in Emmett's `onAfterSchemaCreated` hook, inside the migration's transaction and its migration lock, so servers that start together build each index once; a start that created any index then analyses the table, `ANALYZE emt_messages`, so the planner has statistics on the new key expressions at once rather than when autovacuum next analyses the table. On SQLite, which serialises writers, they run just after Emmett's migration, on the same connections, and the hooks a caller passes to `sqliteEventStore` are kept as given.

Building the four indexes on an existing ledger of 1,197,287 messages took 4.6 s on PostgreSQL 18.6, with the analysis, and 2.9 s on SQLite, about 3.9 s and 2.4 s per million messages at that size, measured as the time the ledger took to open (see [Measurement](#measurement)). On PostgreSQL the build blocks appends for as long, so the first start after an upgrade holds appends that long. The database's user must own the messages table to create them, as the user that created it does.

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

A cursor is the base64url encoding, without padding, of a JSON array: the brain key and the position of a record on SQLite, such as `["brain/acme/sales/","1234"]`; the brain key, the transaction id and the position on PostgreSQL. Each record's id is its own cursor, and `nextCursor` is the cursor of the last record the page examined. A cursor that is not such an array, holds a different number of parts than the store keeps, or holds a part that is not a decimal of at most 2^63 − 1 fails the read with `InvalidCursor` of kind `malformed`; one that is well formed but names another brain fails with kind `of_another_brain`. The brain-bound read turns either into `invalid_input` at `/cursor`, with a detail that says which. A cursor is not encrypted: whoever decodes it learns a position of the ledger.

### The bounds of a page

A page examines records in order and ends at the first of its bounds, with `nextCursor`:

- `limit`, 1 to 100 records answered: without a filter of types, the page examines that many; with one, it examines up to 1,000 records, or 1,000 runs for a list of runs filtered by the type of their latest message, and answers those of its types, possibly none.
- 4 MiB of data loaded, counted from the length of each record's stored JSON before any is loaded: `octet_length(message_data)` on SQLite, which reads the length alone, and `octet_length(message_data ->> 'json')` on PostgreSQL, the text inside the wrapper, so no SQL parses an event's own JSON. The first record a page wants is always loaded, so a record larger than the bound ends a page of its own.

A page takes at most three statements: when `since` is given, one that finds where the page starts; one that examines the page without loading data; and one that loads the data of the records it delivers, by position. Every statement binds at most 15 parameters, far below the 100 a hosted SQLite takes; SQLite takes each list, of stored types or positions, as one JSON parameter through `json_each`. None needs a transaction.

### Times and data

`recordedAt` is the time the store recorded a message: SQLite's `created`, `CURRENT_TIMESTAMP` in UTC to the second, given as `2026-10-05T09:00:00.000Z`; PostgreSQL's `created`, `now()`, the start of the append's transaction, to the millisecond. `since` finds the first message the brain recorded at or after it, by recorded time then position, through the second index; the page starts there oldest first and ends there newest first. SQLite rounds `since` down to the second, so a page from a time may begin with messages of the same second recorded just before it.

The data of a record is decoded as the store's `read` decodes it: on SQLite the stored JSON text, parsed as Emmett's serializer parses it, and on PostgreSQL the `{"json": …}` wrapper, read back by the same `dataAsJsonText`. An event that holds U+0000 is read like any other.

### Measurement

`measure.ts` at the root of this package records these numbers again, writing the data of `measure/dataset.ts`:

```bash
LEDGER_MEASURE_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm --filter @beonauto/ledger measure
```

It fills a temporary SQLite file and, when `LEDGER_MEASURE_POSTGRESQL_URL` names a server, a database of its own there, which it drops afterwards; without it, it measures SQLite alone. `LEDGER_MEASURE_RUNS` sets the runs, 100,000 when left out and at least 50,016, since the deep pages start from run 50,000. It prints the time the ledger took to open and build its indexes, and a table of pages.

Measured on 2026-10-05 on an Apple M4 Max, with Node 26.10, SQLite 3.52.0 through `sqlite3` 6.0.1 on a file, and PostgreSQL 18.6, the image CI uses, in a local container with its default settings (128 MB of shared buffers).

The ledger held 1,197,287 messages. One brain held 497,287 of them: 100,000 runs, each its start and, but for the 2,714 still running, its finish (87,286 succeeded, 5,000 rejected, 4,000 deferred, 1,000 failed), and for every tenth run a run log of 20 inputs of 2 KiB; and one more run, still running, whose run log took an input with each of the others, so that its two streams hold 100,001 messages. 99 other brains held the other 700,000. Every 200th run, 500 in all, took an input of 256 KiB and an output of 1 MiB of text that does not compress; the others an input of 320 bytes and an output of 640. The command opened the ledger on an empty database, dropped its four indexes, and inserted the messages with SQL, one run at a time and on PostgreSQL in a transaction each, followed by `VACUUM ANALYZE`; then it opened the ledger again, which built the indexes, in 2.9 s on SQLite and 4.6 s on PostgreSQL, where it then analysed the table, and read. Last, other brains wrote a million messages in one statement, the newest of the ledger, PostgreSQL's table was analysed again, as autovacuum would, and the command read three pages of the brain newest first once more. A deep page starts from the first message of run 50,000, a time from the moment that run started.

Each page was read through `Ledger.readRecorded`, 20 records or runs to a page unless the table says 100, three times to warm and then 20 times. The table gives the median and the slowest of the 20 in milliseconds, the records the page answered, a run answering its first and its latest message, and the data they held.

| Page                                                                                     | SQLite, median (slowest) | PostgreSQL, median (slowest) | Records | Data     |
| ---------------------------------------------------------------------------------------- | ------------------------ | ---------------------------- | ------- | -------- |
| The brain, first page, newest first                                                      | 0.33 (0.53)              | 1.25 (2.04)                  | 20      | 11 KiB   |
| The brain, first page, oldest first                                                      | 0.28 (0.33)              | 1.83 (2.09)                  | 20      | 42 KiB   |
| The brain, deep page, newest first                                                       | 0.28 (0.32)              | 1.10 (1.20)                  | 20      | 11 KiB   |
| The brain, deep page, oldest first                                                       | 0.31 (0.67)              | 1.96 (2.27)                  | 20      | 43 KiB   |
| The brain, deep page of 100, newest first                                                | 0.75 (1.18)              | 2.36 (3.21)                  | 100     | 121 KiB  |
| The brain, a page holding a run of 1.25 MiB                                              | 1.03 (1.76)              | 8.13 (9.78)                  | 20      | 1302 KiB |
| The brain, of one rare type, newest first                                                | 0.69 (0.74)              | 2.08 (2.36)                  | 2       | 0 KiB    |
| The brain since a time, oldest first                                                     | 0.32 (0.36)              | 2.16 (2.48)                  | 20      | 41 KiB   |
| The brain since a time, newest first                                                     | 0.28 (0.37)              | 1.99 (2.40)                  | 20      | 11 KiB   |
| One run of 21 messages, oldest first                                                     | 0.29 (0.34)              | 3.07 (3.36)                  | 20      | 42 KiB   |
| One run of 21 messages, newest first                                                     | 0.27 (0.63)              | 1.72 (3.90)                  | 20      | 43 KiB   |
| A run of 100,001 messages, first page, oldest first                                      | 0.24 (0.27)              | 2.13 (2.47)                  | 20      | 4 KiB    |
| A run of 100,001 messages, first page, newest first                                      | 0.27 (0.29)              | 1.50 (1.95)                  | 20      | 4 KiB    |
| A run of 100,001 messages, from its middle, oldest first                                 | 0.26 (0.71)              | 2.56 (2.76)                  | 20      | 4 KiB    |
| A run of 100,001 messages, from its middle, newest first                                 | 0.28 (0.33)              | 1.85 (2.36)                  | 20      | 4 KiB    |
| Runs, first page, newest first                                                           | 0.39 (0.47)              | 1.67 (2.13)                  | 38      | 28 KiB   |
| Runs, first page, oldest first                                                           | 1.13 (2.29)              | 9.19 (11.16)                 | 38      | 1306 KiB |
| Runs, deep page, newest first                                                            | 0.36 (0.42)              | 1.67 (2.03)                  | 39      | 29 KiB   |
| Runs, deep page, oldest first                                                            | 1.05 (1.41)              | 8.95 (10.07)                 | 40      | 1308 KiB |
| Runs, deep page of 100, newest first                                                     | 1.17 (1.64)              | 2.86 (3.21)                  | 197     | 145 KiB  |
| Runs that succeeded, newest first                                                        | 2.75 (3.56)              | 2.63 (3.16)                  | 40      | 31 KiB   |
| Runs that succeeded, deep page, oldest first                                             | 3.54 (5.19)              | 11.09 (12.94)                | 40      | 1310 KiB |
| Runs that failed, newest first                                                           | 2.58 (2.69)              | 4.02 (4.72)                  | 20      | 9 KiB    |
| Runs that failed, deep page, oldest first                                                | 2.55 (2.67)              | 4.87 (5.33)                  | 20      | 9 KiB    |
| Runs of a status none has, 1,000 examined                                                | 2.45 (2.53)              | 3.23 (3.39)                  | 0       | 0 KiB    |
| The brain, newest first, behind a million newer messages of other brains                 | 0.21 (0.26)              | 1.46 (1.60)                  | 20      | 11 KiB   |
| Runs, newest first, behind a million newer messages of other brains                      | 0.37 (2.44)              | 2.19 (2.76)                  | 38      | 28 KiB   |
| A run of 100,001 messages, newest first, behind a million newer messages of other brains | 0.25 (0.30)              | 1.25 (2.59)                  | 20      | 4 KiB    |

Every page, unfiltered or filtered by status, answered within 12 ms at the median and 13 ms at the slowest, under the bar of 50 ms this ledger set itself for staying without a read model ([decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md)). The slowest pages are those that load a run of 1.25 MiB; a page of runs filtered by status examines up to 1,000 runs, which SQLite does all at once and PostgreSQL only until the page is full.

## Creating the layer

Each database has an entry of its own, so that code which never uses a database does not load its driver.

```ts
import { ledgerLayer } from '@beonauto/ledger/sqlite3';

const layer = ledgerLayer({ fileName: '/data/ledger.db' });
```

Building the layer creates the directory of the database file if it is missing, then opens the database and migrates its tables before the ledger is ready; a directory that cannot be created or a database that cannot be opened is a defect at that point. Disposing the runtime closes every connection. `fileName: ':memory:'` gives a private in-memory database.

Each SQLite connection may cache up to 8 MiB of pages and maps none of the file into memory, where the driver's defaults allow about 1 GB of cache and 256 MiB of mapped file per connection. Every connection, the tests' temporary files included, runs in WAL mode with `synchronous=NORMAL`, the defaults of Emmett's connection layer, dumbo: a committed append survives a crash of the process, and only the latest commits can be lost if the machine loses power, since in that mode SQLite syncs the file at each checkpoint rather than at each commit. Measured on 2026-10-05 on an Apple M4 Max through `sqlite3` 6.0.1, an append of one event of 1.8 KB to a temporary file took 0.20 to 0.23 ms at the median with either setting, since macOS syncs only to the drive's cache; with `fullfsync` on, so that each sync reaches the drive as on a disk that honours syncs, it took 5.9 ms with `FULL` and 0.20 to 0.24 ms with `NORMAL`, whose syncs at checkpoints showed as 5.2 ms at p99.

```ts
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';

const layer = postgresqlLedgerLayer({ connectionString: 'postgresql://brains:<password>@db.internal:5432/brains' });
```

Building the layer connects to the database and creates or migrates Emmett's tables, functions and sequence in its `public` schema, the way Emmett documents it (`schema.migrate()` with automatic migration off), before the ledger is ready. A database that cannot be reached is a defect at that point, and its message names the host and port, never the password. Emmett's migrator holds an advisory lock on the database while it migrates, so servers that start together on an empty database migrate it once. The connections come from `pg`, the pure-JavaScript driver, through one pool for each ledger, of at most 10 connections, `pg`'s default; disposing the runtime ends the pool. When the database ends a connection, as a restart, a failover or `pg_terminate_backend` does, the ledger logs a warning with the database's message and the pool opens another connection on the next call; the server never stops for it.

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

The same ledger must also run on hosted SQLite databases that bind at most 100 parameters in one statement and offer no interactive transactions, so it follows these rules:

- It uses the event store's own operations to read a stream, or its tail after a version, append with an expected version, migrate and close. Its one SQL of its own is a read on each store, of what a brain recorded, with the indexes it creates when it opens. Nothing on the write path is its own SQL: it registers no projections or consumers, and an append is Emmett's alone.
- It does not rely on transactions or rollback: each command makes at most one append.
- An append on SQLite carries at most eight events. Emmett binds ten parameters for each event it inserts, and such a database binds at most 100 in one statement.
- Only the entries `src/sqlite3.ts` and `src/postgresql/postgresql-ledger.ts` know which driver is in use; the main entry loads neither `sqlite3` nor `pg`.
- A SQLite database the ledger opens must provide what the read uses: `octet_length` (SQLite 3.43 and later), window functions (3.25 and later), the JSON functions, of which the read uses `json_each` (built in since 3.38), and partial and expression indexes (3.8 and 3.9). The hosted runtime's adapter is held to the same.
- No adapter or application may nest a stream under `executions/` within a brain: the key of a stream's kind ends at the fourth `/`, so the list of runs would take any stream named `executions/<id>/…` for a run.

## Testing

The ledger's behaviour is one suite, in `src/testing/ledger-behaviour.ts`, that `src/ledger.test.ts` runs on SQLite and `src/postgresql/ledger-on-postgresql.test.ts` runs on PostgreSQL. Its part on reading what a brain recorded, `src/testing/recorded-behaviour.ts` and `src/testing/runs-behaviour.ts`, also runs on the in-memory ledger of `@beonauto/operations`, in `src/recorded/recorded-in-memory.test.ts`, so the three agree. A read behind an append whose transaction is still open, the same read newest first, a list of runs oldest first behind such an append, a write open in another database that hides nothing, and a start that finds the indexes while an append is open are tested on PostgreSQL alone, since SQLite serialises appends. Before each read of what a brain recorded, the PostgreSQL entry of the suite waits until no committed message of its own database lies behind the horizon, polling every 20 ms for at most 10 s and failing the test past that; the tests that wait have a timeout of 30 s, above vitest's 5 s. The SQLite entry and the in-memory ledger do not wait. `src/testing` holds 15 files, the most a folder holds, so the next helper of the tests opens a folder of its own.

```bash
docker run --detach --name ledger-pg-test --publish 127.0.0.1:19632:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm check
docker rm --force ledger-pg-test
```

CI's Verify job runs it on every pull request against a PostgreSQL service container.
