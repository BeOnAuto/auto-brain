# 1. Run workflows on an engine on the ledger, not on Temporal

- Status: accepted
- Date: 2026-10-04

## Context

Workflow specs run on Temporal today, the wrong place for them:

- Temporal cannot run on Cloudflare Workers, where Auto's cloud hosting runs auto-brain: there is no Temporal worker for workerd.
- Nobody asked for Temporal. People ask for workflows that wait, retry and survive a restart, and a self-hosted server must run a Temporal service beside it to get them.
- Tenant data is stored twice: Temporal's history holds each workflow's document, input, the outputs of its calls and its events, unencrypted, beside the brain's ledger.
- We already have the store: the ledger keeps every brain's events with Emmett on SQLite, on the sqlite3, D1 and Durable Object drivers.

We weighed three other engines. Cloudflare Workflows runs only on Cloudflare, so self-hosted servers would need a second engine. Restate and Inngest are services of their own: a self-hosted server would run one beside it, as with Temporal, and each keeps step results in its own store, so tenant data would still be stored twice.

## Decision

A run is a decider in Emmett's workflow shape, on the load-decide-append loop the ledger already uses, with the ledger's own conflict retry:

- `decide(input, state)` says what an input changes and `evolve(state, event)` applies it. The inputs are a start, a timer fired, a call answered, an event received and a cancel request, each with the time it arrived, never earlier than the input before it.
- One stream per run. An applied input appends one event, with the version it was decided on as the expected version.
- The stream is a state-transition log, not classic event sourcing. Each event holds the change to the state as a JSON Patch, a receipt naming the input, the steps it ran and the outputs: arm or cancel a timer, start or cancel a call, settle. Replay applies patches and evaluates nothing, so a run started under one version of the interpreter loads under the next, and the receipt and steps keep the log readable. Every event and snapshot names its state format; a new format ships with upcasters.
- Outputs are dispatched after the append, in stream order behind a watermark per run, and again on wake until they all succeed. Each is idempotent by its key: timer id, call key (execution, task reference, run) or execution id. A cancel that arrives before its start leaves a tombstone.
- Deduplication lives in the run's state. Emmett is the store, never the engine: we use neither its workflow handler, which folds the whole stream for every input, nor its processors.
- A snapshot follows 1,000 inputs, or as many bytes of events as the last snapshot took and at least 1 MiB; only the latest is kept, in chunks of at most 1 MiB under the 2 MB row limit of D1 and Durable Object SQLite. A run may hold 4 MiB instead of 16, take 100,000 inputs and write 512 MiB of history.
- Four adapters sit behind small ports: run store, timers, executor and record store, with the watermark and per-run serialisation beside them.
- On Cloudflare, each run is one Durable Object, its stream in the object's SQLite and its timers on the object's alarm; a brain object keeps the record and an org object the registry; a cron sweep wakes runs that fell behind.
- Self-hosted, one server keeps the ledger and every run in one SQLite file, in one process; a second process on that file is unsupported. Timers go through the ledger's own SQLite driver or a separate file.
- A PostgreSQL adapter, later, assumes no 2 MB row limit and takes a lease per run for serialisation.

## Consequences

The main cost is rewriting the interpreter as a machine that steps from state to state instead of an async function Temporal replays. Its DSL, expressions and policy stay.

We give up Temporal's durable timers, deduplicated delivery, replay, web UI and operator tools. We must build and keep correct:

- Timers that fire at least once; a fire of a timer no longer armed changes nothing.
- Deduplication in state, every key bounded, or snapshots grow with the run.
- The watermark: a crash between append and dispatch loses nothing.
- The sweep, for alarms that fire late after eviction or give up after their retries.
- Serialisation per run: an in-process lock in Node, the object's thread on Cloudflare.
- Settlement in two stores, the run's stream and the brain's record, each idempotent by execution id, the second retried.

Reads over the ledger and Studio replace Temporal's UI.

Nothing running on Temporal is migrated: nothing is in production, and the switch happens before a release.

Ended streams are kept; a deletion policy is a later decision.

Tenant data is stored once, and a workflow needs no service beyond the server.

## Evidence

Branch `spike/engine-node`:

- `spikes/node/results/replay.json`: the interpreter as it runs on Temporal replays 40,000 inputs in 4.6 s and retains up to 103 MiB.
- `spikes/node/results/message-id-probe.json`: Emmett appends a message with an id it has seen as a new message.
- `spikes/node/results/executor-virtual.json`, `executor-real.json`: a result delivered four times settles once, a result after its timeout is ignored, a crash after the append is recovered on wake.
- `spikes/node/results/timers-precision.json`, `timers-recovery.json`: timers fire 3.7 ms late at p99 when idle; after a killed scheduler all 200 fire, none twice.
- `spikes/node/results/timers-two-processes.json`: two processes double-fire 227 of 300 timers unless each claims a timer first.
- `spikes/node/results/lost-write-repeat.json`: timers written through a second SQLite library to the ledger's file lost committed cancels in three runs of three.

Branch `spike/engine-cloudflare`:

- `spikes/cloudflare/results/fold.json`, `heap.json`: folding 40,000 events cold takes 239 ms and holds 66 MiB; from a snapshot every 1,000 events, 9 ms and 1.6 MiB. Cloudflare documents 30 s of CPU per request by default, which local workerd does not enforce: 35 s of CPU finished under the default and 2 s under `cpu_ms = 50`.
- `spikes/cloudflare/results/timers.json`: alarms fire 5 ms late at p99; an evicted object's alarm fired 15.6 s late; a sweep re-armed one that had given up.
- `spikes/cloudflare/results/settlement.json`: the record was written exactly once, or given up as intended, under every injected D1 fault and crash; D1 refuses eleven events in one append.
- `spikes/cloudflare/results/portability.json`: the interpreter, the DSL policy, jq and both Cloudflare ledger drivers run in workerd; the workflow SDK's validators run once precompiled.
