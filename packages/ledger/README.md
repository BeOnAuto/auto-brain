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

- `sqliteEventStore(optionsOf)` opens the event store on any of Emmett's SQLite drivers, without the layer, and `postgresqlEventStore({ connectionString, reportLostConnection })` from `@beonauto/ledger/postgresql` opens it on PostgreSQL. Both are one adapter over an Emmett event store, `emmettEventStore`, given how each keeps an event's data and how many events it takes in one append.
- `EventStore.read(stream, after)` gives the events after version `after` and the version of the whole stream, so a reader that holds a snapshot at version `after` reads only the tail. Emmett answers a read past the end of a stream with version 0; `read` answers with `after` instead.
- `EventStore.mostEventsInOneAppend` is the most events the store takes in one append.
- `eventAppenderOf(store)` encodes and appends events with an expected version, at most `store.mostEventsInOneAppend` in one append, and fails with `VersionConflict` when another writer appended first.
- `retriedOnVersionConflict(attempt)` runs a load-decide-append attempt again after a version conflict, up to three more times, and then fails with `Conflict`.
- `decisionLoop(load, append, decider)` is the load-decide-append loop itself, the one `Ledger.execute` runs: it loads, decides, appends the decided events with the loaded version expected, retries with `retriedOnVersionConflict`, and answers with what the load gave, the events and the folded state. The ledger's load folds the whole stream; a caller with snapshots passes a load that folds a snapshot and its tail.

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

- It uses only the event store's own operations: read a stream, or its tail after a version, append with an expected version, migrate, close. It writes no SQL and registers no projections or consumers.
- It does not rely on transactions or rollback: each command makes at most one append.
- An append on SQLite carries at most eight events. Emmett binds ten parameters for each event it inserts, and such a database binds at most 100 in one statement.
- Only the entries `src/sqlite3.ts` and `src/postgresql/postgresql-ledger.ts` know which driver is in use; the main entry loads neither `sqlite3` nor `pg`.

## Testing

The ledger's behaviour is one suite, in `src/testing/ledger-behaviour.ts`, that `src/ledger.test.ts` runs on SQLite and `src/postgresql/ledger-on-postgresql.test.ts` runs on PostgreSQL. The PostgreSQL leg runs when `LEDGER_TEST_POSTGRESQL_URL` names a server, creating a database of its own for each test and dropping it afterwards, and is skipped otherwise, saying so in its title:

```bash
docker run --detach --name ledger-pg-test --publish 127.0.0.1:19632:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19632/postgres pnpm check
docker rm --force ledger-pg-test
```

CI's Verify job runs it on every pull request against a PostgreSQL service container.
