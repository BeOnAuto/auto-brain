# 1. Run workflows on an engine on the ledger, not on Temporal

- Status: accepted
- Date: 2026-10-04

## Context

Workflow specs run on Temporal today, the wrong place for them:

- Temporal cannot run on Cloudflare Workers, where Auto's cloud hosting runs auto-brain: there is no Temporal worker for workerd.
- Nobody asked for Temporal. People ask for workflows that wait, retry and survive a restart, and a self-hosted server must run a Temporal service beside it to get them.
- Tenant data is stored twice: Temporal's history holds each workflow's document, input, the outputs of its calls and its events, unencrypted, beside the brain's ledger.
- We already have the store: the ledger keeps every brain's events with Emmett on SQLite, on the sqlite3, D1 and Durable Object drivers.

## Decision

A run is a decider in Emmett's workflow shape, on the load-decide-append loop the ledger already uses:

- `decide(input, state)` says what happened and `evolve(state, event)` folds it. The inputs are a start, a timer fired, a call answered, an event received and a cancel request, each with the time it arrived.
- One stream per run. An applied input appends one event, with the version it was decided on as the expected version. The event holds the change to the state as a JSON Patch, so replay evaluates nothing, and the outputs: arm or cancel a timer, start or cancel a call, settle.
- Outputs are dispatched after the append, behind a watermark per run, and again on wake until they all succeed. Each is idempotent by its key: timer id, call key (execution, task reference, run) or execution id.
- Deduplication lives in the run's state. Emmett is the store, never the engine: we use neither its workflow handler, which folds the whole stream for every input, nor its processors.
- A snapshot follows every 1,000 inputs or 1 MiB of events, whichever comes first; only the latest is kept, in chunks of at most 192 KiB. A run may hold 4 MiB instead of 16.
- Four adapters sit behind small ports: run store, timers, executor and record store, with the watermark and per-run serialisation beside them.
- On Cloudflare, each run is one Durable Object, its stream in the object's SQLite and its timers on the object's alarm; a brain object keeps the record and an org object the registry; a cron sweep wakes runs that fell behind.
- Self-hosted, one server keeps the ledger and every run in one SQLite file, in one process.

## Consequences

We give up Temporal's durable timers, deduplicated delivery, replay, web UI and operator tools. We must build and keep correct:

- Timers that fire at least once, on a table in Node and on the object's alarm on Cloudflare; a fire of a timer no longer armed changes nothing.
- Deduplication in state, every key bounded, or snapshots grow with the run.
- The outbox watermark: a crash between append and dispatch loses nothing.
- The sweep on Cloudflare, for alarms that fire late after eviction or give up after their retries.
- Serialisation per run: an in-process lock in Node, the object's thread on Cloudflare.
- Settlement in two stores, the run's stream and the brain's record, each idempotent by execution id, the second retried.

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

- `spikes/cloudflare/results/fold.json`, `heap.json`: folding 40,000 events cold takes 239 ms and holds 66 MiB; from a snapshot every 1,000 events, 9 ms and 1.6 MiB.
- `spikes/cloudflare/results/timers.json`: alarms fire 5 ms late at p99; an evicted object's alarm fired 15.6 s late; a sweep re-armed one that had given up.
- `spikes/cloudflare/results/settlement.json`: the record was written exactly once, or given up as intended, under every injected D1 fault and crash; D1 refuses eleven events in one append.
- `spikes/cloudflare/results/portability.json`: the interpreter, the DSL policy, jq and both Cloudflare ledger drivers run in workerd; the workflow SDK's validators run once precompiled.
