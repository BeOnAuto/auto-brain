# @beonauto/workflow-host

The workflow engine of [`@beonauto/workflow-engine`](../workflow-engine) on Node: its ports over the ledger and a few tables of the host's own beside it, and the loop the server runs. The engine knows no brains and no database; this package is where a run meets both. [Decision 0001](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) says why workflows run on an engine on the ledger, and [decision 0002](../../docs/decisions/0002-reading-runs-and-brain-events.md) how a run's history is read.

## Entry

`@beonauto/workflow-host` (`src/index.ts`) exports `openWorkflowHost(options)`, which opens the host's database, migrates its tables, starts its loop and answers with a `WorkflowHost`:

- `start(run, start)`: starts the run of an execution with the `started` input, and answers `started`; `going` when the run started before and has not settled its execution, so nothing starts again; or `settled` when the run ended and its execution was settled, since a run never starts twice in one log.
- `deliver(run, event)`: gives the run an `event_received` input, and answers `delivered`, also for an event the run took before; `not_started` for a run whose `started` has not arrived; or `ended` for a run that ended.
- `stateOf(run)`: the run's state, loaded from its store.
- `stop()`: a clean stop, below.

Both fail with the engine's `Conflict` when the run's log kept changing while an input was decided, and with `HostStopped` once the host is stopping. The caller gives the host:

| Option                 | What it is                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`             | `{ store: 'sqlite', file }` or `{ store: 'postgresql', connectionString }`, the database the ledger is kept in                              |
| `machine`              | the machine's options: the functions a workflow may call and the runtime its expressions see                                                |
| `perform`              | `(call, run) => Effect<CallResult>`: what a call does; it never fails, a function that cannot answer answers `unreachable`                  |
| `settle`               | `SettleExecution` of `@beonauto/specs`: how a run's outcome is recorded on its execution                                                    |
| `reports`              | where the host tells the operator of a run it could not settle (`unsettled`), of a failure it retries (`trouble`), and of a lost connection |
| `sweepEveryMs`         | how often the loop sweeps, 1,000 in the server                                                                                              |
| `mostCallsAtOnce`      | how many calls run at once                                                                                                                  |
| `clock`, `cacheBounds` | the clock, `Date.now` unless given, and the bounds of the engine's cache of loaded runs, `runCacheBounds` unless given                      |

## Where a run is kept

A run is addressed by its brain and its execution id, `{ org, brain, executionId }`, since an execution id is unique within a brain only. The engine knows a run by one opaque id, which the host makes `<org>/<brain>/<execution id>`; org ids hold no `/`, brain ids hold none, and execution ids are UUIDs, so the id splits back into its address.

| What                          | Where                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| the run's log                 | the stream `brain/<org>/<brain>/runs/<execution id>` on the ledger                                        |
| the latest snapshot           | `workflow_snapshot_chunks`, in chunks of at most 1 MiB of UTF-8                                           |
| timers and their tombstones   | `workflow_timers`, keyed by run and timer id                                                              |
| calls, answers and tombstones | `workflow_calls`, keyed by the call key                                                                   |
| the dispatch watermark        | `workflow_runs`, one row a run, with the version of the event that ended it and when a sweep last took it |
| due times                     | `workflow_due`, one row a run                                                                             |
| settle receipts               | `workflow_settlements`, one row a run, with the settlement recorded or the attempts that failed           |

The log is written with the ledger's own append, `eventAppenderOf` over the event store, and read with its stream read, `EventStore.read`, so the history of a run (`get_execution_history`, which reads `runs/<execution id>` beside `executions/<execution id>`) and the events of the brain find it, and the ledger's rule holds: the ledger writes no SQL of its own on its write path, and the host owns its tables.

The tables are in the ledger's own database: the same SQLite file, opened through the same `sqlite3` library the ledger uses, or the same PostgreSQL database. `behindRuns` joins the watermarks to Emmett's `emt_streams`, and a join needs both in one database. One SQLite library in the process also keeps clear of what the spike on branch `spike/engine-node` found, that a second SQLite library writing to the ledger's file lost committed writes (`spikes/node/results/lost-write-repeat.json`). The host opens its own connections from the settings the ledger is opened from (`LEDGER_FILE` or `DATABASE_URL`): on SQLite one pool, its writer serialising the host's writes and its run logs' appends, and on PostgreSQL the event store's pool and one of at most four connections for its tables. It creates its tables with `CREATE TABLE IF NOT EXISTS` when it opens, on PostgreSQL in one transaction under an advisory lock of its own. `LEDGER_FILE=:memory:` opens a private database in memory, so the host's runs are not in the ledger's; it is for tests.

### Why snapshots are kept in a table

A snapshot is not an event: it is the run's state at a version, a cache of its fold. Kept on the ledger under the brain, the feed of the brain and the history of a run would read it; kept in a stream outside `brain/`, it could never be let go of, since the ledger only appends and the decision keeps only the latest snapshot. So each snapshot is chunked by the engine's `snapshotChunks` into rows of `workflow_snapshot_chunks`, each row naming the number of chunks of its version; a load takes the newest version whose chunks are all there, a save writes a version only if it is newer than the newest whole one and then deletes the others, and a save is refused unless the log holds the event the snapshot folds to, so a snapshot is written only after its event is durable (invariants 16 and 24). A crash between two chunks leaves a version the load passes over and the next save deletes.

## The ports

- **Timers.** `arm` inserts a timer unless its row exists: `armed`; an armed or fired timer is `already_armed`, a tombstone `refused_after_cancel`. `cancel` disarms an armed timer, `cancelled`; a timer never seen gets a tombstone, `tombstoned`; a fired one is `already_fired`. `sweep` inserts the timers of the run's state the table lost. The loop fires a due timer as a `timer_fired` input and marks it fired only after the engine took it, so a crash in between fires it again, and the run takes the second fire as stale.
- **Executor.** `start` records the call as running and runs `perform` in a fiber of its own, at most `mostCallsAtOnce` at once; its answer is recorded, then given to the run as `call_answered`, then marked given. A start of a call answered before gives the answer again, `answered_again`; of one this host runs, `running`; of one recorded as running that no fiber runs, because the host that ran it died, starts it again, `started_again`. `cancel` records a tombstone and interrupts the call's fiber. A call that outlasts its step is closed by the run itself when its `call_deadline` timer fires, and the cancel that follows interrupts it here. Every sweep resumes the calls recorded as running that no fiber runs, and gives again the answers recorded but not given; so does the first sweep after a start.
- **Record store.** `settle` records the run's outcome on its execution with `settle`, the execution settler of `@beonauto/specs`, with an empty record for a run that succeeded, and keeps the settlement as the run's receipt: the same settlement again is `already_recorded`, another `settled_otherwise`. An execution the brain does not have is `unknown_execution`. A settlement the record refuses, as when the run ended before the call that started it recorded the execution as finishing later, fails to be dispatched again, and after 20 failed attempts is given up as `settled_otherwise`, which the reporter logs. `noteDue` keeps the newest due time of a run by version, a settled run is due no more, and `dueRuns` reads them by an index on the due time.
- **Watermark.** `read` and `advance`, which never goes down. `behindRuns(limit)` joins the runs to `emt_streams` and takes those whose stream holds an event above their watermark, least recently taken first, marking each with a number that counts up with every hand-out, as the memory watermark does. A run whose last event ended it and whose watermark reached that event leaves the partial index the join walks, so a sweep reads only the runs still going.
- **Serialiser.** One semaphore a run, made when an input comes and let go of when none waits.
- **Reporter.** The operator's log, through `reports.unsettled`.

Every port passes the probes of `@beonauto/workflow-engine/testing` on SQLite and on PostgreSQL (`src/testing/port-suite.ts`).

## The loop

The loop fires timers when they are due and sweeps every `sweepEveryMs`. After each tick it sleeps until the next armed timer is due or the next sweep, whichever comes first, and a timer armed earlier than that wakes it. A sweep is the engine's `sweep` of the runs overdue by a minute, which arms again the timers a run's state holds and the table lost, and of up to 1,024 runs whose dispatch fell behind, then the resumption of calls. A timer that cannot fire, because its run's log kept changing, is put off to the next sweep and reported; a sweep that fails is reported and tried at the next.

`stop()` refuses new starts and events, lets the tick in progress finish, so the decisions it takes are appended and dispatched, interrupts the calls in progress, which stay recorded as running and start again at the next start, waits for the starts and events already taken, and closes the database. Everything else is left for the next start: runs whose dispatch fell behind are swept, overdue timers fire, and calls resume.

With one server for a database, nothing else claims a run. Workflows need one server per database, on SQLite as on PostgreSQL; a lease per run, for several servers sharing a PostgreSQL database, is a later step.

## Measurements

`pnpm --filter @beonauto/workflow-host measure` (`measure.ts`, with its parts in `measure/`) measures on a temporary SQLite file and, when `LEDGER_MEASURE_POSTGRESQL_URL` names a server, on a database of its own there, which it drops afterwards:

- timer lateness: 1,000 runs, each waiting two seconds, started one after another; the lateness of a timer is the time of its `timer_fired` input, the start of the tick that fired it, less the time it was due, read from each run's log;
- inputs a second: the long-run loop of the engine's `src/engine/long-run.test.ts`, 3,000 inputs, through the host on a clock that skips to the next due time, and 100 such runs of 100 inputs side by side;
- recovery after a restart: a run holding a value of 1,100,000 bytes, which makes a snapshot of 1.05 MiB, and 50 events after it; the time the host took to open again, then the first input of that run, which loads the snapshot and the events after it, and the next.

Measured on 2026-10-05 on an Apple M4 Max with Node 26.10.0, SQLite 3.52.0 through `sqlite3` 6.0.1, and PostgreSQL 18.6 in a local container with its default settings:

| What                                                                | SQLite                                     | PostgreSQL                                  |
| ------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| timer lateness over 1,000 timers                                    | 0 ms at the median, 4 ms at p99, 8 at most | 2 ms at the median, 6 ms at p99, 16 at most |
| the long-run loop, 3,000 inputs of one run                          | 2.89 s, 1,038 inputs a second              | 16.55 s, 181 inputs a second                |
| 100 runs of 100 inputs side by side                                 | 7.29 s, 1,372 inputs a second              | 8.23 s, 1,216 inputs a second               |
| the host opened again                                               | 2.6 ms                                     | 23.6 ms                                     |
| the first input after it, snapshot of 1,101,463 bytes and 50 events | 2.5 ms                                     | 22.6 ms                                     |
| the next input, the run kept                                        | 0.6 ms                                     | 2.6 ms                                      |

One run's inputs are taken one at a time, each a few round trips to the database: on PostgreSQL that bounds one run to about 180 inputs a second, while runs side by side share the database's time. The spike's timers fired 3.7 ms late at p99 when idle (`spikes/node/results/timers-precision.json`); the host's, armed by the runs it decides, fired 4 to 6 ms late at p99.

## Testing

The suites of `src/testing` run on SQLite in `src/host/host-on-sqlite.test.ts` and on PostgreSQL in `src/host/host-on-postgresql.test.ts`, which needs `LEDGER_TEST_POSTGRESQL_URL` and makes a database of its own for each test:

- the probes of every port;
- a run that waits, calls a function, takes an event and ends, settling its execution once;
- the long-run loop of 3,000 inputs, loaded again from its last snapshot and the events after it to the state its whole log folds to: 2.7 s on SQLite and 14 to 17 s on PostgreSQL, on the machine above;
- a host killed through its process handle while it dispatches, once while a call runs and once while it records the run's settlement, then started again on the same database: the call starts again, and the run settles once (`host-process.ts` at the root of the package is the host the test starts).

The other tests run on SQLite alone, as the ledger's do for what is the same on both stores.

```bash
docker run --detach --name workflow-host-pg --publish 127.0.0.1:19647:5432 --env POSTGRES_PASSWORD=ledger-test postgres:18.6-alpine
LEDGER_TEST_POSTGRESQL_URL=postgresql://postgres:ledger-test@127.0.0.1:19647/postgres pnpm --filter @beonauto/workflow-host test
docker rm --force workflow-host-pg
```

## Source

`src/database` opens the host's database on either store and holds its tables; `src/runs` the run's address and its store; `src/dispatch` the watermark and the serialiser; `src/timers` the timers; `src/calls` the executor; `src/settlement` the record store; `src/loop` the clock and the loop; `src/host` the host itself; and `src/testing` what the tests share, the suites both stores run among it.
