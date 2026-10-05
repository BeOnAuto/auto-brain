# 1. Run workflows on an engine on the ledger, not on Temporal

- Status: accepted, amended
- Date: 2026-10-04, amended 2026-10-05 (see Amendments)

## Context

auto-brain's image runs self-hosted, as one Node process with one SQLite file, and in Auto's cloud hosting. There the engine must run in a single-threaded isolate for each run, woken by alarms that fire at least once and are dropped after a bounded number of failed retries, with bounded memory (about 128 MB) and bounded CPU for each wake-up, no long-lived process and no code generation; each isolate keeps its state in its own SQLite, whose rows take at most 2 MB, and the database the isolates share has no interactive transactions and binds at most 100 parameters in one statement. This record calls that the hosted runtime.

Workflow specs run on Temporal today, the wrong place for them:

- Temporal cannot run in the hosted runtime: a Temporal worker is a long-lived process, and the hosted runtime has none.
- Nobody asked for Temporal. People ask for workflows that wait, retry and survive a restart, and a self-hosted server must run a Temporal service beside it to get them.
- Tenant data is stored twice: Temporal's history holds each workflow's document, input, the outputs of its calls and its events, unencrypted, beside the brain's ledger.
- We already have the store: the ledger keeps every brain's events with Emmett on SQLite, through the sqlite3 driver self-hosted and through the drivers for the isolate's own and the shared SQLite in the hosted runtime.

We weighed three other engines. The hosted runtime's own workflow service runs only there, so self-hosted servers would need a second engine. Restate and Inngest are services of their own: a self-hosted server would run one beside it, as with Temporal, and each keeps step results in its own store, so tenant data would still be stored twice.

## Decision

A run is a decider in Emmett's workflow shape, on the ledger's own load-decide-append loop and conflict retry, `decisionLoop`, with a load that folds a snapshot and its tail, or takes the run the engine kept loaded after the input before while its stream has no event after it:

- `decide(input, state)` says what an input changes and `evolve(state, event)` applies it. The inputs are a start, a timer fired, a call answered, an event received and a cancel request, each with the time it arrived, never earlier than the input before it.
- One stream per run. An applied input appends one event, with the version it was decided on as the expected version.
- The stream is a state-transition log, not classic event sourcing. Each event holds the change to the state as a JSON Patch, a receipt naming the input, the steps it ran and the outputs: arm or cancel a timer, start or cancel a call, settle. Replay applies patches and evaluates nothing, so a run started under one version of the interpreter loads under the next, and the receipt and steps keep the log readable.
- Every event and snapshot names its state format. Each event folds under its own format, the state is upcast where the format changes, formats never go back within a stream, and a committed corpus of every format must load as a test.
- Outputs are dispatched after the append, in stream order behind a watermark per run, and again on wake until they all succeed. Each is idempotent by its key: timer id, call key (execution, task reference, run) or execution id. Every started call has a deadline timer, so every call is answered.
- Deduplication lives in the run's state. Emmett is the store, never the engine: we use neither its workflow handler, which folds the whole stream for every input, nor its processors.
- A snapshot follows once the events since the last one take as many bytes as it did, and at least 1 MiB; only the latest is kept, in chunks of at most 1 MiB under the 2 MB row limit of the hosted runtime's SQLite. A run may take 100,000 inputs and write 512 MiB of history, both checked in `decide`.
- Four adapters sit behind small ports: run store, timers, executor and record store, with the watermark and per-run serialisation beside them.
- In the hosted runtime: one isolate per run, its stream in the isolate's SQLite and its timers on the isolate's alarm; one for the brain's record; one for the org's registry; a scheduled sweep wakes the runs the record says are overdue and the runs whose dispatch watermark is below the version of their stream, which a shared index of each run's watermark and version names, since no table holds every isolate's stream.
- Self-hosted, one server keeps the ledger and every run in one SQLite file, in one process; a second process on that file is unsupported. Timers go through the ledger's own SQLite driver or a separate file.
- A PostgreSQL adapter, later, assumes no 2 MB row limit and takes a lease per run for serialisation.
- The package `@beonauto/workflow-engine` is the workflow machine's contract, since the state is shaped by the workflow DSL, and the DSL lives in it. The orchestration primitive imports the DSL from it and keeps parsing, the primitive, the event and cancel operations and, for now, the Temporal runtime. The engine knows no brains, specs or primitives: the caller names the functions a workflow may call. Its `./dsl/*` and `./limits` entries are transitional: they keep Effect and the ledger out of the Temporal workflow bundle and go when Temporal goes.

Still open, due before the hosted adapters: how the hosted runtime executes a call that runs longer than the CPU one wake-up allows, as a step of a durable workflow service outside the isolate or through a queue to a container.

## Consequences

The main cost is rewriting the interpreter, 129 tests of it beside the DSL's 79, as a machine that steps from state to state instead of an async function Temporal replays. Its DSL, expressions and policy stay, and so do its retry arithmetic and what a switch, a raise, a catch and a call's result decide, which both runtimes now share from the engine's DSL.

Tenants see four changes. A run may hold 4 MiB of data instead of 16. A single value a run holds across a wait or a yield, such as a call's answer or the data a task passes on, may take no more than one event holds with the rest of its input's change, 1,572,864 bytes of JSON, since the event of the input that made it carries it whole; a larger one ends the run with `An input changed the run by N bytes, more than the 1572864 one event holds`, where the interpreter let one value take all the data a run holds. A repeated event no longer counts toward the events a run takes over its life. And a workflow that executes a workflow through a primitive name it computes fails with a `validation` error, once the executor rejects the call as `invalid_arguments`, where the interpreter raises a `configuration` error today. The written case, `primitive: orchestration`, is still refused at `create_spec` as forbidden; only a computed name reaches the executor. Both errors have status 400 and settle the execution as `invalid_input`; the visible difference is the error `type`, which a `catch.errors.with` filter matches.

A run's history takes about seven times the bytes Temporal's did, 1,804 bytes an input against 243 for a loop that waits, since each event holds its patch, its steps and its outputs as JSON; a run of 100,000 such inputs stays within its 512 MiB. The engine's README measures it; the patch stays RFC 6902, and a run store may compress what it keeps.

We give up Temporal's durable timers, deduplicated delivery, replay, web UI and operator tools. We must build and keep correct:

- Timers that fire at least once; a fire of a timer no longer armed changes nothing.
- Deduplication in state, every key bounded, or snapshots grow with the run.
- The watermark: a crash between append and dispatch loses nothing.
- The sweep, for alarms that fire late or give up after their retries.
- Serialisation per run: an in-process lock in Node, the isolate's single thread in the hosted runtime.
- Settlement in two stores, the run's stream and the brain's record, each idempotent by execution id, the second retried; the ledger's port appends to one stream, so they are never one transaction.

Reads over the ledger and Studio replace Temporal's UI.

Nothing running on Temporal is migrated: nothing is in production, and the switch happens before a release.

Ended streams are kept; a deletion policy is a later decision.

Tenant data is stored once, and a workflow needs no service beyond the server.

## Plan

- The machine, on the contract and the DSL in `@beonauto/workflow-engine`: built, with an engine on memory ports and a driver over it in the package's `testing` entry.
- A conformance suite: the same workflow probes through a fake driver, the Node adapter and the hosted adapter, seeded from the server's `src/workflow-executions` tests. The probes of the ports' contract, which the memory ports pass, are in the `testing` entry for the adapters to run.
- The adapters, a `cancel_execution` operation, and the workflow SDK's validators precompiled, since the hosted runtime allows no code generation.
- The cutover: `pnpm dev` without Temporal's dev server, and the README.
- Measurements before and after: the 15 recorded histories through the driver; inputs per second, and bytes per input against Temporal's 9.26 MiB for 40,000 inputs; timer lateness at p99; heap per live run; snapshot bytes per run. The machine's, through the memory driver, are in the engine's README; timer lateness waits for the adapters.

## Amendments

2026-10-05, with the machine, after its review (the engine's README has the detail and the tests):

- Tenants see four changes, not three: a value held across a wait or a yield is bounded by the 1,572,864 bytes one event holds (Consequences).
- A run is stopped when it has run `mostDurationMs`, its deadline armed at that limit exactly; the interpreter stops one an hour before, since Temporal's own timeout would end it unsettled, and the machine needs no such margin.
- The engine keeps the runs it loaded between their inputs, in a cache bounded by runs and by bytes, so an input does not load again the snapshot and the events the input before it left; a failed append or a saved snapshot lets go of the run.
- A run whose dispatch fell behind is found by its watermark, below the version of its stream, rather than by a note in the record, so a failed note of its due time cannot hide it from the sweep.

## Evidence

Branch `spike/engine-node`:

- `spikes/node/results/replay.json`: the interpreter as it runs on Temporal replays 40,000 inputs in 4.6 s and retains up to 103 MiB; its log takes 9.26 MiB.
- `spikes/node/results/message-id-probe.json`: Emmett appends a message with an id it has seen as a new message.
- `spikes/node/results/executor-virtual.json`, `executor-real.json`: a result delivered four times settles once, a result after its timeout is ignored, a crash after the append is recovered on wake.
- `spikes/node/results/timers-precision.json`, `timers-recovery.json`: timers fire 3.7 ms late at p99 when idle; after a killed scheduler all 200 fire, none twice.
- `spikes/node/results/timers-two-processes.json`: two processes double-fire 227 of 300 timers unless each claims a timer first.
- `spikes/node/results/lost-write-repeat.json`: timers written through a second SQLite library to the ledger's file lost committed cancels in three runs of three.

The measurements in the hosted runtime are kept in the private repository:

- Folding 40,000 events cold takes 239 ms and holds 66 MiB; from a snapshot every 1,000 events, 9 ms and 1.6 MiB. The hosted runtime documents 30 s of CPU for each wake-up by default; its local runtime enforced no CPU limit at all: 35 s of CPU finished with no limit set, and 2 s with a limit of 50 ms.
- Alarms fire 5 ms late at p99; an alarm due while the local runtime was stopped fired 15.6 s late, when it was restarted; a sweep re-armed one that had given up.
- The record was written exactly once, or given up as intended, under every injected fault of the shared database and every crash; the shared database refuses eleven events in one append.
- The interpreter, the DSL policy, jq and both hosted ledger drivers run in the isolate; the workflow SDK's validators run once precompiled.
