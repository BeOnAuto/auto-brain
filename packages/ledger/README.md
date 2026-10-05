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

`Ledger.readRecorded(brain, selection, page)`, the read the `Ledger` port of `@beonauto/operations` describes, is answered by the store: one SQL read of its own on each store, over Emmett's messages table, with three indexes the ledger adds to it. The selections, the page and its bounds are the port's; this section says how each store answers them.

### The brain key

Every stream of a brain is named `brain/<org>/<brain>/…`. The store takes the key of a message's stream, its name through the third `/`, with an expression, and compares it to the brain's key, `brain/<org>/<brain>/`, with `=`. It never matches with `LIKE` or any pattern: org and brain ids may hold uppercase letters and `_`, SQLite's `LIKE` ignores case, and `_` matches any character in both stores. A stream name with fewer than three `/` has no key and belongs to no brain.

| Store      | The key of a stream                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| SQLite     | `substr(stream_id, 1, …)` to the third `/`, found with nested `instr`, since SQLite has no regular expressions |
| PostgreSQL | `substring(stream_id FROM '^(?:[^/]*/){3}')`, null for a name with fewer than three `/`                        |

The same expression taken to the fourth `/` gives the key of a stream's kind within its brain, such as `brain/acme/sales/executions/`.

### The indexes

The ledger creates three indexes when it opens, with `CREATE INDEX IF NOT EXISTS`, in Emmett's `onAfterSchemaCreated` hook. The hook runs inside the migration's transaction, which on PostgreSQL holds Emmett's migration lock, so servers that start together on one database build each index once.

| Index                               | SQLite                                   | PostgreSQL                                                                       | What reads it                                               |
| ----------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ledger_messages_by_brain`          | brain key, position                      | brain key, transaction id, position                                              | a brain's messages, in order, from any cursor               |
| `ledger_messages_by_brain_and_time` | brain key, recorded time                 | brain key, recorded time, transaction id, position                               | where a page `since` a time starts                          |
| `ledger_first_messages_by_kind`     | kind key, position, first messages alone | kind key, transaction id, position, first messages alone (`stream_position = 1`) | the runs of a brain, by the position of their first message |

The third index holds the first message of every stream, and only those. The list of runs walks it, so a page of runs costs the same however many messages the run logs of a brain hold between two runs, and PostgreSQL's planner, which keeps statistics on the kind key, knows how many runs a brain has. Without it, on a ledger of 598,362 messages, PostgreSQL estimated 845 first messages of runs where there were 60,000, and answered a page of runs filtered by status with a sequential scan of the whole table, in 122 to 126 ms; with it, the same pages took 1.4 to 3.5 ms.

Building the three indexes once on an existing ledger of 1,097,286 messages took 2.5 s on PostgreSQL 18.6 and 2.5 s on SQLite, measured as the time the ledger took to open (see [Measurement](#measurement)). On PostgreSQL `CREATE INDEX` takes a lock on the messages table that blocks appends until the build ends, so the first start after an upgrade holds appends that long. Every later start finds the indexes and takes that lock only for an instant, after the appends in flight. The database's user must own the messages table to create them, as the user that created it does.

### Order, and the horizon on PostgreSQL

On SQLite appends are serialised, so global positions follow commits, and the read orders by position.

On PostgreSQL a message takes its global position when it is inserted and becomes visible when its transaction commits, so a later position can be visible before an earlier one. The read therefore orders by transaction id, then global position, and reads only messages whose transaction id is below the oldest transaction still open, exactly as Emmett's own batch read does: `readMessagesBatchSQL` in `@event-driven-io/emmett-postgresql` 0.43.0-beta.50, `dist/index.js` lines 1274 to 1289, reads `AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())` at line 1285 and `ORDER BY transaction_id, global_position` at line 1287. Oldest first, a reader that goes on from its last record gets a message whose transaction was still open during an earlier page once that transaction commits, and never skips it. Newest first, a pass delivers what lay behind the horizon when it began. Either way the most recent end of a read waits for the oldest transaction still open that holds a transaction id, anywhere on the PostgreSQL server: transaction ids belong to the whole server, not to one database, and PostgreSQL gives a transaction its id when it first writes. So an append in flight, a ledger migrating as a server starts, a `CREATE DATABASE`, or a long write of another application that shares the server holds back the newest messages of every ledger on it until it ends; the tests show it with a write left open in another database.

### The cursor

A cursor is the base64url encoding, without padding, of a JSON array: the brain key and the position of a record on SQLite, such as `["brain/acme/sales/","1234"]`; the brain key, the transaction id and the position on PostgreSQL. Each record's id is its own cursor, and `nextCursor` is the cursor of the last record the page examined. Decoding one checks that it is such an array, that it names the brain being read, that it holds as many parts as the store keeps, and that each is a decimal of at most 2^63 − 1; any other cursor fails the read with `InvalidCursor`, which the brain-bound read turns into `invalid_input` at `/cursor`. A cursor is not encrypted: whoever decodes it learns a position of the ledger.

### The bounds of a page

A page examines records in order and ends at the first of its bounds, with `nextCursor`:

- `limit`, 1 to 100 records examined, of which a `types` filter keeps those of its types, possibly none.
- 4 MiB of data loaded, counted from the length of each record's stored JSON before any is loaded: `octet_length(message_data)` on SQLite, which reads the length alone, and `octet_length(message_data ->> 'json')` on PostgreSQL, the text inside the wrapper, so no SQL parses an event's own JSON. The first record a page wants is always loaded, so a record larger than the bound ends a page of its own.
- 1,000 runs examined by a list of runs filtered by the type of their latest message.

A page takes at most three statements: when `since` is given, one that finds where the page starts; one that examines the page without loading data; and one that loads the data of the records it delivers, by position. Every statement binds fewer than a dozen parameters, far below the 100 a hosted SQLite takes; SQLite takes each list, of stored types, streams or positions, as one JSON parameter through `json_each`. None needs a transaction.

### Times and data

`recordedAt` is the time the store recorded a message: SQLite's `created`, `CURRENT_TIMESTAMP` in UTC to the second, given as `2026-10-05T09:00:00.000Z`; PostgreSQL's `created`, `now()`, the start of the append's transaction, to the millisecond. `since` finds the first message the brain recorded at or after it, by recorded time then position, through the second index; the page starts there oldest first and ends there newest first. SQLite rounds `since` down to the second, so a page from a time may begin with messages of the same second recorded just before it.

The data of a record is decoded as the store's `read` decodes it: on SQLite the stored JSON text, parsed as Emmett's serializer parses it, and on PostgreSQL the `{"json": …}` wrapper, read back by the same `dataAsJsonText`. An event that holds U+0000 is read like any other.

### Measurement

Measured on 2026-10-05 on an Apple M4 Max, with Node 26.10, SQLite 3.52.0 through `sqlite3` 6.0.1 on a file, and PostgreSQL 18.6, the image CI uses, in a local container with its default settings (128 MB of shared buffers).

The ledger held 1,097,286 messages. One brain held 397,286 of them: 100,000 runs, each its start and, but for the 2,714 still running, its finish (87,287 succeeded, 5,000 rejected, 4,000 deferred, 1,000 failed), and for every tenth run a run log of 20 inputs of 2 KiB. 99 other brains held the other 700,000. Every 200th run, 500 in all, took an input of 256 KiB and an output of 1 MiB of text that does not compress; the others an input of 320 bytes and an output of 640. The messages were inserted with SQL, one run at a time and on PostgreSQL in a transaction each; then the ledger opened and built its indexes, in 2.5 s on SQLite and 2.5 s on PostgreSQL. A deep page starts from the first message of run 50,000, a time from the moment that run started.

Each page was read through `Ledger.readRecorded`, 20 records or runs to a page unless the table says 100, three times to warm and then 20 times. The table gives the median and the slowest of the 20 in milliseconds, the records the page answered, a run answering its first and its latest message, and the data they held.

| Page                                         | SQLite, median (slowest) | PostgreSQL, median (slowest) | Records | Data     |
| -------------------------------------------- | ------------------------ | ---------------------------- | ------- | -------- |
| The brain, first page, newest first          | 0.26 (0.42)              | 1.57 (3.92)                  | 20      | 20 KiB   |
| The brain, first page, oldest first          | 0.23 (0.28)              | 1.73 (4.06)                  | 20      | 42 KiB   |
| The brain, deep page, newest first           | 0.24 (0.83)              | 6.58 (10.42)                 | 20      | 20 KiB   |
| The brain, deep page, oldest first           | 0.25 (0.39)              | 1.60 (2.08)                  | 20      | 43 KiB   |
| The brain, deep page of 100, newest first    | 0.66 (1.09)              | 8.20 (8.98)                  | 100     | 137 KiB  |
| The brain, a page holding a run of 1.25 MiB  | 1.05 (2.37)              | 13.21 (17.40)                | 20      | 1312 KiB |
| The brain, of one rare type, newest first    | 0.10 (0.13)              | 0.53 (0.61)                  | 0       | 0 KiB    |
| The brain since a time, oldest first         | 0.24 (0.31)              | 1.98 (2.28)                  | 20      | 41 KiB   |
| The brain since a time, newest first         | 0.26 (0.33)              | 1.49 (2.65)                  | 20      | 20 KiB   |
| One run of 21 messages, oldest first         | 0.22 (0.26)              | 1.46 (1.92)                  | 20      | 42 KiB   |
| One run of 21 messages, newest first         | 0.23 (0.68)              | 1.40 (1.87)                  | 20      | 43 KiB   |
| Runs, first page, newest first               | 0.37 (0.42)              | 1.86 (3.79)                  | 38      | 28 KiB   |
| Runs, first page, oldest first               | 1.13 (2.24)              | 8.45 (10.44)                 | 39      | 1307 KiB |
| Runs, deep page, newest first                | 0.39 (0.44)              | 2.05 (2.21)                  | 39      | 29 KiB   |
| Runs, deep page, oldest first                | 1.16 (1.68)              | 8.45 (10.80)                 | 40      | 1308 KiB |
| Runs, deep page of 100, newest first         | 1.19 (1.78)              | 3.42 (3.61)                  | 197     | 145 KiB  |
| Runs that succeeded (87 %), newest first     | 2.81 (3.56)              | 1.39 (1.56)                  | 40      | 31 KiB   |
| Runs that succeeded, deep page, oldest first | 3.78 (4.09)              | 8.51 (10.04)                 | 40      | 1310 KiB |
| Runs that failed (1 %), newest first         | 2.71 (2.87)              | 3.67 (4.26)                  | 20      | 9 KiB    |
| Runs that failed, deep page, oldest first    | 2.65 (2.76)              | 4.41 (5.25)                  | 20      | 9 KiB    |
| Runs of a status none has, 1,000 examined    | 2.59 (2.68)              | 3.37 (3.88)                  | 0       | 0 KiB    |

Every page, unfiltered or filtered by status, answered within 14 ms at the median and 18 ms at the slowest, under the bar of 50 ms this ledger set itself for staying without a read model (decision 0002). The slowest pages are those that load a run of 1.25 MiB; a page of runs filtered by status examines up to 1,000 runs, which SQLite does all at once and PostgreSQL only until the page is full.

## Creating the layer

Each database has an entry of its own, so that code which never uses a database does not load its driver.

```ts
import { ledgerLayer } from '@beonauto/ledger/sqlite3';

const layer = ledgerLayer({ fileName: '/data/ledger.db' });
```

Building the layer creates the directory of the database file if it is missing, then opens the database and migrates its tables before the ledger is ready; a directory that cannot be created or a database that cannot be opened is a defect at that point. Disposing the runtime closes every connection. `fileName: ':memory:'` gives a private in-memory database.

Each SQLite connection may cache up to 8 MiB of pages and maps none of the file into memory, where the driver's defaults allow about 1 GB of cache and 256 MiB of mapped file per connection.

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

Several servers may share one PostgreSQL database for brains and spec operations: every command is a decision appended under an expected version, so concurrent writers never lose an update. Workflows still need one server, as the Temporal design assumes: the workflow engine's serialisation of a run on PostgreSQL, a lease per run, is a later step.

## Portability

The same ledger must also run on hosted SQLite databases that bind at most 100 parameters in one statement and offer no interactive transactions, so it follows these rules:

- It uses the event store's own operations to read a stream, or its tail after a version, append with an expected version, migrate and close. Its one SQL of its own is a read on each store, of what a brain recorded, with the indexes it creates when it opens. Nothing on the write path is its own SQL: it registers no projections or consumers, and an append is Emmett's alone.
- It does not rely on transactions or rollback: each command makes at most one append.
- An append on SQLite carries at most eight events. Emmett binds ten parameters for each event it inserts, and such a database binds at most 100 in one statement.
- Only the entries `src/sqlite3.ts` and `src/postgresql/postgresql-ledger.ts` know which driver is in use; the main entry loads neither `sqlite3` nor `pg`.

## Testing

The ledger's behaviour is one suite, in `src/testing/ledger-behaviour.ts`, that `src/ledger.test.ts` runs on SQLite and `src/postgresql/ledger-on-postgresql.test.ts` runs on PostgreSQL. Its part on reading what a brain recorded, `src/testing/recorded-behaviour.ts` and `src/testing/runs-behaviour.ts`, also runs on the in-memory ledger of `@beonauto/operations`, in `src/recorded/recorded-in-memory.test.ts`, so the three agree. A read behind an append whose transaction is still open is tested on PostgreSQL alone, since SQLite serialises appends. The PostgreSQL leg runs when `LEDGER_TEST_POSTGRESQL_URL` names a server, creating a database of its own for each test and dropping it afterwards, and is skipped otherwise, saying so in its title:

```bash
docker run --detach --name ledger-pg-test --publish 127.0.0.1:19632:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm check
docker rm --force ledger-pg-test
```

CI's Verify job runs it on every pull request against a PostgreSQL service container.
