# Workflow operations

The server runs its workflows itself. The [workflow host](../../../packages/workflow-host/README.md) runs every run in the server's own process and keeps it in the ledger's database, beside the brain's records, so nothing runs beside the server, in development or in a container.

## Where a run is kept

A run's log is a stream of the ledger, `runs/<execution id>` under its brain, which the history of the run and the events of the brain read. The host keeps seven tables of its own in the same database: the latest snapshot of each run, its timers, its calls and their answers, the dispatch watermark, the due times, the settlements and the claim on the workflows (`workflow_snapshot_chunks`, `workflow_timers`, `workflow_calls`, `workflow_runs`, `workflow_due`, `workflow_settlements` and `workflow_leases`). It creates them when it starts, in the SQLite file of `LEDGER_FILE` or in the PostgreSQL database of `DATABASE_URL`, so a backup of the ledger's database holds the workflows too.

Several servers may share a database, and one of them runs its workflows at a time. That server holds a claim on them, a row of `workflow_leases`, which it renews at every sweep and which lapses the longer of three sweeps and ten seconds after it was last renewed, so a pause of that server shorter than that, as for garbage collection, does not hand its workflows to another. A server that finds the claim held by another stands by: it serves everything else, answers workflow operations `unavailable` with `The workflows of this database run in another server; ...`, and warns once at start-up, naming the holder. It tries the claim at every sweep, and takes the workflows over, with a warning, once the claim lapsed, as when the server that held it died, or was let go of, as when that server stopped. A server that cannot renew its claim for as long as a claim lasts stops running workflows and stands by, since another may then hold it. The claim reads each server's clock, so the servers' clocks must agree to well within ten seconds. After a server that held the claim dies, another takes the workflows over within about ten seconds and a sweep.

## Starting, stopping and restarting

The server logs one line at start-up, `Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms`, with the settings below.

When it stops, the server lets the starts and events it already took finish, and the work the host is deciding, so what it decided is appended and handed out, cuts off the calls in flight, lets go of its claim on the workflows, so a server standing by takes them over at its next sweep, and closes the database; it does not wait for a call to end. A call cut off stays recorded and is performed again when the server next starts, under the same execution id, so a nested execution that already has a final result is answered from the ledger. The first sweep after a start fires the timers that came due while the server was stopped, hands out what a run decided and did not hand out, and resumes the calls.

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
- `/health` answers whether the server is alive. The host's trouble is logged as warnings, each saying what failed and what happens next: `A sweep of the runs failed; the next sweep tries again`, `A timer of a run could not fire; it fires again at the next sweep`, `An answer of a call could not be recorded; it is written again until it is`, `A call could not record its answer`, `An answer of a call could not be given to its run` and `The claim of this server on the workflows of its database could not be renewed`, with the cause cut at 2,000 characters; on PostgreSQL, a lost connection is a warning too.
- There are no limits for one org and no fairness between orgs: every org's runs share the server's thread and its `ORCHESTRATION_NESTED_EXECUTIONS` calls at a time.
- A run whose settlement the ledger refuses, as while the ledger cannot be reached, is settled again at every sweep, and after 20 attempts once a minute until it is; the server warns once when it starts backing off and once when the execution is settled. An execution the ledger does not have, or one already settled otherwise, is logged as an error with its org, brain, execution id and reason.
- The engine keeps at most 1,024 loaded runs and 64 MiB of the data they hold, and a run holds at most 4 MiB. Measured once with the arm64 image and no memory limit, the server took about 180 MiB idle. The [engine's README](../../../packages/workflow-engine/README.md#limits) lists the limits of a run, and the [host's README](../../../packages/workflow-host/README.md#measurements) how late timers fire and how fast runs go on each store.
