# @beonauto/workflow-host

The workflow engine of [`@beonauto/workflow-engine`](../workflow-engine) on Node: its ports over the ledger and a few tables of the host's own beside it, and the loop the server runs. The engine knows no brains and no database; this package is where a run meets both. [Decision 0001](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) says why workflows run on an engine on the ledger, and [decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) how a run's history is read.

## Entry

`@beonauto/workflow-host` (`src/index.ts`) exports `openWorkflowStore(settings, lostConnection)`, which opens the host's database and migrates its tables, answering a `WorkflowStore` with the database and the `ViewsPort` of [the views of recall functions](#the-views-of-recall-functions), and `openWorkflowHost(options)`, which opens the host's database, or takes the store it is given, migrates its tables, claims the database's workflows (see [One host for a database](#one-host-for-a-database)), starts its loop if it holds them, and answers with a `WorkflowHost`:

- `start(run, start)`: starts the run of an execution with the `started` input, and answers `started`; `going` when the run started before and has not settled its execution, so nothing starts again, after trying again at once the settlement of a run that ended; or `settled` when the run ended and its execution was settled, since a run never starts twice in one log.
- `deliver(run, event)`: gives the run an `event_received` input, and answers `delivered`, also for an event the run took before; `not_started` for a run whose `started` has not arrived; or `ended` for a run that ended.
- `stateOf(run)`: the run's state, loaded from its store.
- `stop()`: a clean stop, below.

Both fail with the engine's `Conflict` when the run's log kept changing while an input was decided, with `HostElsewhere` while another host holds the database's workflows, and with `HostStopped` once the host is stopping. The caller gives the host:

| Option                 | What it is                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`             | `{ store: 'sqlite', file }` or `{ store: 'postgresql', connectionString }`, the database the ledger is kept in, or a `WorkflowStore` opened on it               |
| `views`                | optional `ProjectorSettings`: the projector that keeps the views of recall functions while the host holds the database's workflows                              |
| `machine`              | the machine's options: the functions a workflow may call and the runtime its expressions see                                                                    |
| `perform`              | `(call, run) => Effect<CallResult>`: what a call does; it never fails, a function that cannot answer answers `unreachable`                                      |
| `settle`               | `SettleExecution` of `@beonauto/specs`: how a run's outcome is recorded on its execution                                                                        |
| `reports`              | where the host tells the operator of a run it could not settle (`unsettled`), of a failure it retries (`trouble`), of a lost connection, and its notes (`note`) |
| `sweepEveryMs`         | how often the loop sweeps, 1,000 in the server                                                                                                                  |
| `mostCallsAtOnce`      | how many calls run at once                                                                                                                                      |
| `clock`, `cacheBounds` | the clock, `Date.now` unless given, and the bounds of the engine's cache of loaded runs, `runCacheBounds` unless given                                          |
| `holder`               | the id the host claims the database's workflows with, a random UUID unless given                                                                                |

## Where a run is kept

A run is addressed by its brain and its execution id, `{ org, brain, executionId }`, since an execution id is unique within a brain only. The engine knows a run by one opaque id, which the host makes `<org>/<brain>/<execution id>`; org ids hold no `/`, brain ids hold none, and execution ids are UUIDs, so the id splits back into its address.

| What                          | Where                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| the run's log                 | the stream `brain/<org>/<brain>/runs/<execution id>` on the ledger                                                        |
| the latest snapshot           | `workflow_snapshot_chunks`, in chunks of at most 1 MiB of UTF-8                                                           |
| timers and their tombstones   | `workflow_timers`, keyed by run and timer id, with the version of the record that armed each                              |
| calls, answers and tombstones | `workflow_calls`, keyed by the call key                                                                                   |
| the dispatch watermark        | `workflow_runs`, one row a run, with the version of the event that ended it and when a sweep last took it                 |
| due times                     | `workflow_due`, one row a run                                                                                             |
| settle receipts               | `workflow_settlements`, one row a run, with the settlement recorded, or the attempts that failed and when the last was    |
| the claim on the workflows    | `workflow_leases`, the row `host`, with its holder and when it lapses                                                     |
| the views of recall functions | `recall_views`, one row a recall function of a brain; see [The views of recall functions](#the-views-of-recall-functions) |

The log is written with the ledger's own append, `eventAppenderOf` over the event store, with the lineage of each record (see [The lineage of a run's records](#the-lineage-of-a-runs-records)), and read with its stream read, `EventStore.read`, so the history of a run (`get_execution_history`, which reads `runs/<execution id>` beside `executions/<execution id>`) and the events of the brain find it, and the ledger's rule holds: the ledger writes no SQL of its own on its write path, and the host owns its tables.

The tables are in the ledger's own database: the same SQLite file, opened through the same `sqlite3` library the ledger uses, or the same PostgreSQL database. `behindRuns` joins the watermarks to Emmett's `emt_streams`, and a join needs both in one database. One SQLite library in the process also keeps clear of what the spike on branch `spike/engine-node` found, that a second SQLite library writing to the ledger's file lost committed writes (`spikes/node/results/lost-write-repeat.json`). The host opens its own connections from the settings the ledger is opened from (`LEDGER_FILE` or `DATABASE_URL`): on SQLite one pool, its writer serialising the host's writes and its run logs' appends, and on PostgreSQL the event store's pool and one of at most four connections for its tables. It creates its tables with `CREATE TABLE IF NOT EXISTS` when it opens, on PostgreSQL in one transaction under an advisory lock of its own. `LEDGER_FILE=:memory:` opens a private database in memory, so the host's runs are not in the ledger's; it is for tests.

### The lineage of a run's records

The host reads, from the attributes a run is started with, `lineage`: `start`, the id of the `execution_started` that began the run, and `correlation`, the id of the run at the top of its tree; a run started without it is a run of its own, correlated to its execution id, with no cause for its first record. Every record of the run's log is written with that correlation and, from the cause the engine gives with it:

| The engine's cause | The cause written                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `start`            | the `start` of the run's lineage                                                                                                          |
| `resumed`          | the id of the `step_waiting` event of the entry the input resumed, `stepEventIdOf` of `@beonauto/workflow-engine`                         |
| `timer`            | the id of the record that armed the timer, from the version `workflow_timers` keeps beside it, or nothing for a timer a sweep armed again |
| `none`             | nothing                                                                                                                                   |

The record store settles a run with the same correlation, caused by the step event of the last entry of the record that ended the run, or by that record when it has none. `workflow_timers` gained its column `armed_by` after it was first made: a database made before it has the column added when the host opens, with `ALTER TABLE`, on SQLite once it finds it missing and on PostgreSQL with `ADD COLUMN IF NOT EXISTS` in the migration's transaction.

### Why snapshots are kept in a table

A snapshot is not an event: it is the run's state at a version, a cache of its fold. Kept on the ledger under the brain, the feed of the brain and the history of a run would read it; kept in a stream outside `brain/`, it could never be let go of, since the ledger only appends and the decision keeps only the latest snapshot. So each snapshot is chunked by the engine's `snapshotChunks` into rows of `workflow_snapshot_chunks`, each row naming the number of chunks of its version; a load takes the newest version whose chunks are all there, a save writes a version only if it is newer than the newest whole one and then deletes the others, and a save is refused unless the log holds the event the snapshot folds to, so a snapshot is written only after its event is durable (invariants 16 and 24). A crash between two chunks leaves a version the load passes over and the next save deletes.

## The ports

- **Timers.** `arm` inserts a timer unless its row exists, with the version of the record that armed it: `armed`; an armed or fired timer is `already_armed`, a tombstone `refused_after_cancel`. `cancel` disarms an armed timer, `cancelled`; a timer never seen gets a tombstone, `tombstoned`; a fired one is `already_fired`. `sweep` inserts the timers of the run's state the table lost. The loop fires a due timer as a `timer_fired` input and marks it fired only after the engine took it, so a crash in between fires it again, and the run takes the second fire as stale.
- **Executor.** `start` records the call as running and runs `perform` in a fiber of its own, at most `mostCallsAtOnce` at once; its answer is recorded, then given to the run as `call_answered`, then marked given. A start of a call answered before gives the answer again, `answered_again`; of one this host runs, `running`; of one recorded as running that no fiber runs, because the host that ran it died, starts it again, `started_again`. `cancel` records a tombstone and interrupts the call's fiber. A call that outlasts its step is closed by the run itself when its `call_deadline` timer fires, and the cancel that follows interrupts it here. Every sweep resumes the calls recorded as running that no fiber runs, and gives again the answers recorded but not given; so does the first sweep after a start. A call never has two fibers: a start and a resumption that race for one call begin it once. An answer that cannot be written is written again, 50 ms after the first failure and then twice as long each time up to 30 s, until it is, and the first failure is reported; the call is performed again only after the host stopped and started again with its answer unwritten.
- **Record store.** `settle` records the run's outcome on its execution with `settle`, the execution settler of `@beonauto/specs`, with an empty record for a run that succeeded, and keeps the settlement as the run's receipt: the same settlement again is `already_recorded`, another `settled_otherwise`. An execution the brain does not have is `unknown_execution`. A settlement the record refuses, as when the run ended before the call that started it recorded the execution as finishing later, fails, so the watermark stays below the run's last event and every sweep dispatches it again; after 20 failed attempts it is tried once a minute, for ever, and the host notes it once when it begins backing off and once when it is settled at last. A start of a run that ended with its settlement pending tries the settlement again at once, whatever the back-off, and answers `settled` if it then is, and `going` otherwise, leaving the next sweep to try again rather than a minute later. `noteDue` keeps the newest due time of a run by version, a settled run is due no more, and `dueRuns` reads them by an index on the due time.
- **Watermark.** `read` and `advance`, which never goes down. `behindRuns(limit)` joins the runs to `emt_streams` and takes those whose stream holds an event above their watermark, least recently taken first, marking each with a number that counts up with every hand-out, as the memory watermark does. A run whose last event ended it and whose watermark reached that event leaves the partial index the join walks, so a sweep reads only the runs still going.
- **Serialiser.** One semaphore a run, made when an input comes and let go of when none waits.
- **Reporter.** The operator's log, through `reports.unsettled`, and `reports.note` for the notes of the back-off and of the claim below.

Every port passes the probes of `@beonauto/workflow-engine/testing` on SQLite and on PostgreSQL (`src/testing/port-suite.ts`).

## The loop

The loop fires timers when they are due and sweeps every `sweepEveryMs`. After each tick it sleeps until the next armed timer is due or the next sweep, whichever comes first, and a timer armed earlier than that wakes it. A sweep is the engine's `sweep` of the runs overdue by a minute, which arms again the timers a run's state holds and the table lost, and of up to 1,024 runs whose dispatch fell behind, then the resumption of calls. A timer that cannot fire, because its run's log kept changing, is put off to the next sweep and reported; a sweep that fails is reported and tried at the next.

`stop()` refuses new starts and events, waits for the starts and events it already took, lets the tick in progress finish, so the decisions it takes are appended and dispatched, interrupts the calls in progress, which stay recorded as running and start again at the next start, lets go of its claim, and closes the database; once it stopped, no call begins. Everything else is left for the next start: runs whose dispatch fell behind are swept, overdue timers fire, and calls resume.

## One host for a database

The host runs workflows only while it holds the claim on its database, the row `host` of `workflow_leases`, which names its holder, an id the host makes when it opens, and when the claim lapses. The host claims it when it opens and renews it every sweep, and the claim lapses the longer of three sweeps and three seconds after it was last renewed (`leaseMsFor`), so a pause of the holder shorter than that, as for garbage collection, never lets another host take over while the holder's calls still run, even at the shortest sweep of 10 ms. On PostgreSQL the claim is taken, renewed and judged by the database's own clock, `now()`, read before each claim, so the hosts' clocks need not agree; on SQLite one process holds the file, and the host's clock serves. A host that finds another's claim live stands by: its starts and events fail with `HostElsewhere`, which the server answers as `unavailable` with that detail, it notes `standing_by` once, and it tries the claim again every sweep; once the claim lapsed, as when the host that held it died, or was let go of, as when that host stopped, it takes it, notes `took_over`, and runs the workflows from where the other left them. A host that cannot renew its claim for as long as a claim lasts stops running workflows and stands by, since another host may then hold the claim. The row is the same on SQLite and PostgreSQL, and a claim of each run, for several hosts sharing a database, can grow from it: a name per run beside `host`.

## The views of recall functions

A recall function of [`@beonauto/recollection`](../../primitives/recollection) keeps a view of its brain's history, and the host keeps it, in `recall_views` beside its other tables, one row a function of a brain, keyed by the brain and the name:

| Column                                     | What it holds                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `version`, `saved`                         | the version of the function the view is of, and the version of the brain's definition stream that saved it           |
| `details`                                  | the version's `details` as text, the fold, the filters, `initial` and the view's schema, read without the capability |
| `phase`                                    | `waiting`, `rebuilding`, `live` or `stalled`                                                                         |
| `view`                                     | the view as JSON text, never `jsonb`, so a NUL in an event folds like any character                                  |
| `checkpoint`, `checkpoint_at`              | the store's own point of the last record examined, compared part by part as whole numbers, and when it was recorded  |
| `last_event_id`, `last_event_at`, `folded` | the id and time of the last event folded, and the count                                                              |
| `overtimes`                                | how many times the fold of the event at the checkpoint ran out of time, memory or its worker                         |
| `stalled_*`                                | for a stalled view, the event's id, type and time, the kind of stall, the fold's own message and its line            |

The projector reads the rows of a brain without their views, and reads a view only for a page that holds events the view considers, so a brain with nothing new costs a few small reads each sweep, however large its views. `ViewsPort` (`src/views/views-port.ts`) reads a row as a `KeptView`, the checkpoint as the cursor of the brain-bound read, and the time of a brain's newest record, from that record alone. The store is opened before the host, so the recall capability takes the port and the host then opens with it among its function types.

The projector (`src/projector`) runs while the host holds the database's workflows, woken by its sweep and by the ledger's `AppendSignal`, raised in the process on every append. Each sweep it asks the ledger for the definition streams of the recall type, `EventStore.definitionStreams`, through the ledger's partial index on their names, and takes every brain whose stream moved or that has rows; an append to a brain it does not know asks for them at once, so a brain's first recall function, and a brain made after the start, are found without a restart. A brain is passed in a fiber of its own, at most `brainsAtOnce` at once. A pass of a brain:

1. reads the brain's definition stream from where it last read it and brings the rows in line: a function without a row gets one, a newer version resets its row, a retired function's row is dropped, and the first `rebuildsAtOnce` rows that wait or rebuild, in the order saved, rebuild while the others wait; a stalled row holds no slot;
2. reads the brain from the smallest checkpoint of its live views, a page of up to 1,000 records, the most one read of the store examines, of the types the views can match, the fact types their filters name, `event_published` when a filter names any other type, and the three definition types, oldest first behind PostgreSQL's horizon, so an event committed late is folded late, never passed over;
3. folds the page in one worker of the pool (`src/pages`), the projector holding at most half the pool's workers and at least one: each view folds the events after its own checkpoint that its filters match, never the runs of its own function, each fold under its own work, deadline and size and the view's schema, and each filter's `data` test under the same limits, with work of its own, sharing the fold's deadline; the worker checks the page's 2 seconds of folding, counted from its first fold, before each fold, and ends the page early, before the next fold, once they are spent, so at most one fold runs past them;
4. writes each view that moved once, its checkpoint alone when it only read past events, with one statement conditional on the version and the checkpoint it read, so a host that lost the claim, or one that read a row a newer version has since reset, writes nothing, and a dropped row is never made again;
5. goes on from the shared read to each rebuilding view's own read, from its own checkpoint, until it reaches the live views' checkpoint or the end of the history and joins them, ten pages a brain a pass in all, the shared read first.

A fold that raises, gives no output or more than one, runs out of work, nests too deep, outgrows the bound on a view, fails its schema or gives a number JSON cannot hold stalls its view at that event and is noted as `view_stalled`. A fold that runs past its own deadline, 10 seconds, counts a try against its view. So does a page the worker could not finish, because it ran out of memory, crashed or ran past the page's deadline, counted from when the pool took the page, its 2 seconds, one fold's deadline and five seconds more for the worker's start and its answer: the try counts against the fold that was going, from the place the worker marked, in memory it shares with the projector, before each fold. Since the budget is checked before each fold, only a fold that ran past its own deadline can carry a page past the page's, so a view is charged for its own fold alone, never for the folds of its neighbours on the same event. For a lost page the projector folds that view again in a page that ends before the event, so it keeps what it folded before it, writes the try with the checkpoint just before the event, or where that page ended when it ended early on its budget, and leaves the page's other views where they were, to fold the page again. A view charged a try rests until the next sweep, so its fold is tried again on a later pass while the brain's other views go on, and it stalls once it has run out of time, memory or its worker twenty times. A record the projector cannot read as an event is passed over and noted once as `record_passed_over`. A restart folds at most one page again.

## Measurements

`pnpm --filter @beonauto/workflow-host measure` (`measure.ts`, with its parts in `measure/`) measures on a temporary SQLite file and, when `LEDGER_MEASURE_POSTGRESQL_URL` names a server, on a database of its own there, which it drops afterwards:

- timer lateness: 1,000 runs, each waiting two seconds, started one after another; the lateness of a timer is the time of its `timer_fired` input, the start of the tick that fired it, less the time it was due, read from each run's log;
- inputs a second: the long-run loop of the engine's `src/engine/long-run.test.ts`, 3,000 inputs, through the host on a clock that skips to the next due time, and 100 such runs of 100 inputs side by side;
- recovery after a restart: a run holding a value of 1,100,000 bytes, which makes a snapshot of 1.05 MiB, and 50 events after it; the time the host took to open again, then the first input of that run, which loads the snapshot and the events after it, and the next;
- a rebuild: the view of the example recall function built over 100,000 matching runs of 100 campaigns, appended 100 to a stream, counting the pages read and the writes of its row (`measure/rebuild.ts`);
- idle views: 32 live views of a brain, each of 523,891 bytes, with no new events, the share of the event loop the host kept busy over 10 seconds, in milliseconds a second (`measure/idle-views.ts`).

Measured on 2026-10-05 on an Apple M4 Max with Node 26.10.0, SQLite 3.52.0 through `sqlite3` 6.0.1, and PostgreSQL 18.6 in a local container with its default settings, three times for the timers, whose lateness varies from one measurement to the next, and once for the rest:

| What                                                                | SQLite                                                | PostgreSQL                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| timer lateness over 1,000 timers                                    | 0 ms at the median, 2 to 5 ms at p99, 4 to 11 at most | 1 ms at the median, 5 ms at p99, 10 to 17 at most |
| the long-run loop, 3,000 inputs of one run                          | 2.85 s, 1,053 inputs a second                         | 16.82 s, 178 inputs a second                      |
| 100 runs of 100 inputs side by side                                 | 6.90 s, 1,450 inputs a second                         | 8.21 s, 1,218 inputs a second                     |
| the host opened again                                               | 3.0 ms                                                | 27.3 ms                                           |
| the first input after it, snapshot of 1,101,463 bytes and 50 events | 2.4 ms                                                | 22.2 ms                                           |
| the next input, the run kept                                        | 0.6 ms                                                | 2.8 ms                                            |

The rebuild of a view over 100,000 matching events, in pages of up to 1,000 records and then of up to 100, as before, one after the other, and the idle views, against the same measurement of the projector before it read rows without their views, measured on 2026-10-06 on the same machine and stores:

| What                                                    | SQLite                                | PostgreSQL                           |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| the view built, pages of up to 1,000 records            | 103.5 s, 966 events a second          | 111.1 s, 900 events a second         |
| the view built, pages of up to 100 records              | 183.7 s, 544 events a second          | 195.4 s, 512 events a second         |
| pages read, of up to 1,000 and of up to 100 records     | 111 and 1,001                         | 113 and 1,001                        |
| writes of the view's row                                | 111 and 1,000                         | 112 and 1,000                        |
| 32 idle views, the event loop kept busy, now and before | 3.4 to 13.4 ms a second, 560.0 before | 5.0 to 6.3 ms a second, 294.9 before |

These were measured with the machine under a load average of 90 to 165 on its 16 cores, from other work, so an idle machine is faster; the two page sizes were measured one after the other under that same load. A page of up to 1,000 events took about 0.95 s, the example's folds spending about 61,550 units of work an event; the worker the pool starts for each page, 40 to 280 ms when measured alone, is a small part of that, where it was a large part of a page of 100, which took about 0.18 s. Some pages ended at their 2 seconds, so a rebuild read 111 to 113 pages where 101 hold the history. With no new events the projector reads no view, so 32 views of half a megabyte each cost a few milliseconds of the event loop a second, where reading and decoding each of them twice a sweep cost 295 to 560 ms; the idle views were measured twice now, and once before.

One run's inputs are taken one at a time, each a few round trips to the database: on PostgreSQL that bounds one run to about 180 inputs a second, while runs side by side share the database's time. The spike's timers fired 3.7 ms late at p99 when idle (`spikes/node/results/timers-precision.json`); the host's, armed by the runs it decides, fired 2 to 5 ms late at p99 on SQLite and 5 ms on PostgreSQL in the three measurements here, and 9 ms on PostgreSQL in a reviewer's measurement, so allow for up to 10 ms at p99.

## Testing

The suites of `src/testing` run on SQLite in `src/host/host-on-sqlite.test.ts` and on PostgreSQL in `src/host/host-on-postgresql.test.ts`, which needs `LEDGER_TEST_POSTGRESQL_URL` and makes a database of its own for each test:

- the probes of every port;
- a run that waits, calls a function, takes an event and ends, settling its execution once;
- a long loop of 130 inputs, each of which records a value of 8,000 characters, so that its events reach 1 MiB and a snapshot is due at input 109, past half the loop, leaving a tail of 21 events; the run is loaded again from that snapshot and the events after it to the state its whole log folds to. It took 0.27 s on SQLite and 1.0 s on PostgreSQL under coverage, on the machine above. The engine's loop, whose inputs hold a number alone, needs 593 inputs for a snapshot and a tail, and 700 of them took 1.1 s on SQLite and 4.3 s on PostgreSQL, so the loop's inputs are large to keep the test within seconds on a runner ten times slower; the measurements above run the 3,000 inputs of the engine's loop;
- a host killed through its process handle while it dispatches, once while a call runs and once while it records the run's settlement, then started again on the same database: the call starts again, and the run settles once (`host-process.ts` at the root of the package is the host the test starts);
- two hosts on one database: the second stands by while the first holds the claim, refusing starts and performing no call, and once the first is killed through its process handle takes the workflows over after its claim lapsed, three seconds on, and finishes the run; a host that stops hands the claim over at the next sweep; a holder paused for a second through its process handle at the shortest sweep keeps its claim; and a host whose clock runs an hour ahead stands by on PostgreSQL, where the database's clock judges the claim, and takes the claim on SQLite, where each host's does.

The tests that kill a host and start another on the same database wait for the dead host's claim to lapse, about three seconds each.

The test databases on PostgreSQL commit without waiting for the disk (`synchronous_commit = off`), which loses nothing a test reads.

The suites of `src/views-testing` run on SQLite in `src/projector/views-on-sqlite.test.ts` and on PostgreSQL in `src/projector/views-on-postgresql.test.ts`: the example folded over runs whatever their output, the checkpoint at the end of the history, more than a page, a page ended by its time, a function's own runs, published events matched by data, the stalls, the retries of a deadline, a page whose worker broke keeping what its view folded before the event, even when folding up to that event again ends early on its budget, a slow fold charged to its own view alone and never to the views folding the same event, the versions, a brain found without a restart, one shared read, rebuilds in their slots, and the conditional writes; PostgreSQL also folds an event committed late, in the order the ledger recorded it.

The other tests run on SQLite alone, as the ledger's do for what is the same on both stores. Among them `src/projector/projector-bounds.test.ts` reaches the projector's bounds, each with a smaller value of its setting so that it fails when the bound is removed: the pages of a pass, for a live view and for a rebuilding one, the brains passed at once, the half of the pool the projector holds, and a fold that ran past its deadline resting until the next sweep while its brain's other views go on.

```bash
docker run --detach --name workflow-host-pg --publish 127.0.0.1:19647:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19647/postgres pnpm --filter @beonauto/workflow-host test
docker rm --force workflow-host-pg
```

## Source

`src/database` opens the host's database on either store and holds its tables; `src/views` the table of the views, its rows, its points and the views port; `src/projector` the projector, its schedule, its passes and the writes of its rows; `src/pages` a page of events read, folded and turned into changes of the rows; `src/runs` the run's address and its store; `src/dispatch` the watermark and the serialiser; `src/timers` the timers; `src/calls` the executor; `src/settlement` the record store and its back-off; `src/lease` the claim on the database's workflows and its keeper; `src/loop` the clock and the loop; `src/host` the host itself; `src/testing` what the tests share, the suites both stores run among it, and `src/views-testing` the same for the views.
