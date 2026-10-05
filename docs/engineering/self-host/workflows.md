# Workflow operations

The server runs its workflows itself. The [workflow host](../../../packages/workflow-host/README.md) runs every run in the server's own process and keeps it in the ledger's database, beside the brain's records, so nothing runs beside the server, in development or in a container.

## Where a run is kept

A run's log is a stream of the ledger, `runs/<execution id>` under its brain, which the history of the run and the events of the brain read. The host keeps six tables of its own in the same database: the latest snapshot of each run, its timers, its calls and their answers, the dispatch watermark, the due times and the settlements (`workflow_snapshot_chunks`, `workflow_timers`, `workflow_calls`, `workflow_runs`, `workflow_due` and `workflow_settlements`). It creates them when it starts, in the SQLite file of `LEDGER_FILE` or in the PostgreSQL database of `DATABASE_URL`, so a backup of the ledger's database holds the workflows too.

Run one server for a database. Every server runs workflows, and nothing claims a run for one server: two servers on one database would fire the same timers and could perform the same call twice. The run logs would stay consistent, since every append expects the version it was decided on, but a function could be called twice. A lease per run, for several servers sharing a PostgreSQL database, is a later step.

## Starting, stopping and restarting

The server logs one line at start-up, `Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms`, with the settings below.

When it stops, the server lets the work the host is deciding finish, so what it decided is appended and handed out, cuts off the calls in flight, and closes the database; it does not wait for a call to end. A call cut off stays recorded and is performed again when the server next starts, under the same execution id, so a nested execution that already has a final result is answered from the ledger. The first sweep after a start fires the timers that came due while the server was stopped, hands out what a run decided and did not hand out, and resumes the calls.

The host sweeps every `ORCHESTRATION_SWEEP_INTERVAL`, one second unless set otherwise: it resumes the runs that have been due for more than a minute, up to 1,024 runs whose decisions were not all handed out, and the calls recorded as running that nothing runs. A timer fires when it is due, without waiting for a sweep.

| Variable                          | Default | Purpose                                                                              |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `ORCHESTRATION_MAX_DURATION`      | `P30D`  | The most a run may last, an ISO 8601 duration from `PT2H` to `P365D`                 |
| `ORCHESTRATION_NESTED_EXECUTIONS` | `32`    | How many calls of the server's runs run at once, from 1 to 1000; shared by every org |
| `ORCHESTRATION_SWEEP_INTERVAL`    | `PT1S`  | How often the host sweeps the runs, an ISO 8601 duration from `PT0.01S` to `PT1M`    |

A setting the server cannot read stops it at start-up, naming the setting and what it expects, never its value.

## What an operator must know

- A run's log holds its document, its input, the outputs of the functions it calls, the events sent to it and the identity of the caller who started it, in the ledger's database like the brain's other records. Whoever can read the database can read them.
- A run acts for the caller who started it, with the permissions that caller had then, for as long as it runs, at most `ORCHESTRATION_MAX_DURATION`. Revoking the caller's key does not stop it. This version has no operation that cancels a run: a run ends by itself, by a `timeout` its document sets, or when it has run `ORCHESTRATION_MAX_DURATION`, which settles its execution `failed`.
- `/health` answers whether the server is alive. The host's trouble is logged as warnings, each saying what failed and what happens next: `A sweep of the runs failed; the next sweep tries again`, `A timer of a run could not fire; it fires again at the next sweep`, `A call could not record its answer` and `An answer of a call could not be given to its run`, with the cause cut at 2,000 characters; on PostgreSQL, a lost connection is a warning too.
- There are no limits for one org and no fairness between orgs: every org's runs share the server's thread and its `ORCHESTRATION_NESTED_EXECUTIONS` calls at a time.
- An execution whose run could not settle it stays `started`; the server logs it as an error with its org, brain, execution id and reason, and reconciling it is manual in this version.
- The engine keeps at most 1,024 loaded runs and 64 MiB of the data they hold, and a run holds at most 4 MiB. Measured once with the arm64 image and no memory limit, the server took about 180 MiB idle. The [engine's README](../../../packages/workflow-engine/README.md#limits) lists the limits of a run, and the [host's README](../../../packages/workflow-host/README.md#measurements) how late timers fire and how fast runs go on each store.
