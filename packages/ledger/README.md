# @beonauto/ledger

The ledger keeps track of every single action and interaction that the brain does. It is the log of the inputs and outputs to all the primitives.

This package is the event store behind the `Ledger` port of `@beonauto/operations`. It stores events with [Emmett](https://event-driven-io.github.io/emmett/) on SQLite.

## What it stores

- **Streams of events.** The application layer names each stream, for example `org/acme/brains` or `brain/acme/sales/specs/inference`. Names are opaque: the ledger never changes their case, trims them or normalises their Unicode, so two names that differ in any character are two streams.
- **One version per stream.** A stream's version is the number of events in it, and 0 when nobody has written it.
- **Events as Emmett stores them.** Each event becomes `{ type, data }`. `type` is the event's own `type`. `data` is the whole event encoded with `Schema.toCodecJson(decider.eventSchema)`, which must give a JSON object. Loading decodes `data` with the same codec, so an event comes back exactly as it was decided, dates and big integers included. A stored event that no longer decodes is a defect.

## How a command runs

`execute(stream, decider, command)` loads the stream, folds its events with `decider.evolve`, and asks `decider.decide`.

- A refusal is returned as it is, and nothing is appended.
- A decision of no events appends nothing and answers with the current state and version.
- Otherwise the events are appended with the version that was read as the expected version. If another writer appended first, the stream is loaded and the command decided again, up to three more times, and then it fails with `Conflict`. Like the in-memory ledger of `@beonauto/operations`, its detail names no stream.
- A decision of more than eight events is a defect.
- Any other failure of the database is a defect, never a `Conflict` or a refusal.

## Creating the layer

```ts
import { ledgerLayer } from '@beonauto/ledger';

const layer = ledgerLayer({ fileName: '/data/ledger.db' });
```

Building the layer opens the database and migrates its tables before the ledger is ready; a database that cannot be opened is a defect at that point. Disposing the runtime closes every connection. `fileName: ':memory:'` gives a private in-memory database, which is what the tests use.

Each SQLite connection may cache up to 8 MiB of pages and maps none of the file into memory, where the driver's defaults allow about 1 GB of cache and 256 MiB of mapped file per connection.

## Portability

The same ledger will run on Cloudflare D1, so it follows these rules:

- It uses only the event store's own operations: read a stream, append with an expected version, migrate, close. It writes no SQL and registers no projections or consumers.
- It does not rely on transactions or rollback: each command makes at most one append.
- An append carries at most eight events. Emmett binds ten parameters for each event it inserts, and D1 accepts at most 100 bound parameters in one query.
- Only `src/open-event-store.ts` knows which SQLite driver is in use and that the database is a file.
