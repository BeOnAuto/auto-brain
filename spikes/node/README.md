# Spike: the Node and ledger side of a portable workflow engine

Throwaway measurements, not a workspace package and outside the gate (`pnpm check` does not see this folder; `.oxlintrc.json` here lints it with the correctness rules only, because it is in no tsconfig). It imports the interpreter and the ledger by relative path into their `src`.

## Setup

From the root of the repository, with Node 26.10:

```bash
npx --yes pnpm@12.8.1 install --frozen-lockfile --ignore-scripts --config.verify-deps-before-run=false
npx --yes pnpm@12.8.1 --config.verify-deps-before-run=false rebuild sqlite3
node spikes/node/setup.ts   # links effect and Emmett from packages/ledger into spikes/node/node_modules
```

Every command below runs from `spikes/node`. Scratch files go to `.data/` (ignored); measured results go to `results/`.

## 1. Replay cost of the current interpreter

`replay/log-host.ts` is a `WorkflowHost` that drives the real interpreter one input at a time (a timer fired, a call answered, an event delivered), each input its own activation, reusing the fake host's cancellation scopes. `replay/workload.ts` is the workflow (loops of `set` tasks with jq, a `call` with a timeout inside a `try` with retries, a `wait`, a `listen` every 50 items) and the world that answers it.

```bash
node replay/record.ts 40000                      # record a log of 40,000 inputs into .data/
node --expose-gc replay/replay.ts replay 40000   # replay it from scratch once, checking the commands match
node replay/bench.ts                             # 1,000 / 10,000 / 40,000: 5 replays each, heap limits -> results/replay.json
node replay/profile-split.ts 10000               # where replay CPU goes
node --max-old-space-size=4096 replay/heap-census.ts 20000   # what the heap retains after replay
```

## 2. What a step-function rewrite touches

```bash
node rewrite/lines.ts   # interpreter lines by group: pure, promise control flow, closure state
```

`rewrite/step-state.ts` sketches the serialisable state, inputs and outputs as types only.

## 3. Executor idempotency on the ledger

`executor/engine.ts` puts together the run stream (`owf-run:<id>`, `executor/run-stream.ts`), job streams keyed by `(execution, reference, run)` and the dispatch watermark (`executor/side-streams.ts`), on `packages/ledger` over SQLite, and the timers table.

```bash
node executor/virtual-cases.ts      # 20-minute step on a virtual clock -> results/executor-virtual.json
SPIKE_STEP_MS=150000 node executor/real-run.ts   # real clock, a child killed after its append -> results/executor-real.json
node executor/message-id-probe.ts   # what Emmett does with a repeated message id -> results/message-id-probe.json
node executor/lost-write-repeat.ts  # timers on the ledger's own file versus a separate file -> results/lost-write-repeat.json
```

## 4. Timers scheduler and two writers

```bash
node timers/precision.ts       # 300 timers over a minute, idle and loaded -> results/timers-precision.json
node timers/recovery.ts        # kill the scheduler, restart it with timers past due -> results/timers-recovery.json
node timers/two-schedulers.ts  # two processes on one WAL file -> results/timers-two-processes.json
node timers/two-libraries.ts   # node:sqlite and the ledger's sqlite3 on one file, in one process
node timers/missing-check.ts   # the timers the no-busy-timeout variant claimed but never fired
node timers/store-check.ts     # arm, cancel and due on one store, seen from a second connection
```
