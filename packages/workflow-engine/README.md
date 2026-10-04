# @beonauto/workflow-engine

The core of the workflow engine that runs on the ledger: the contract between the machine that runs a workflow and the adapters that store, time and execute for it. It knows workflows, the inputs a run takes and an executor that performs calls. It does not know brains, prompts, models or specs: whatever an adapter needs to know about a run, such as who started it, it passes as opaque `attributes` and gets back with every output.

The same code runs in Node, where one server keeps every run in one SQLite file, and in workerd, where each run is a Durable Object. This package holds the contract: the types, the ports, the idempotency keys, the dispatch watermark, the fold of a run's log and the invariants below. The machine that decides an input is the next step, and the adapters the one after; until then the orchestration primitive runs workflows on Temporal, unchanged. [The decision record](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) says why.

## How a run moves

1. An adapter submits an input for an execution, with `at`, the time on its own clock. The machine never reads a clock, and it takes `max(at, lastInputAt)` as the time of the input, so time in a run never goes back however the adapters' clocks drift.
2. Holding the run's serialisation, the engine loads the run: `RunStore.load` gives the latest snapshot and the events after it, and `loadedRunOf` folds them.
3. `staleReasonOf(state, input)` says whether the input can still change the run. An input to a run whose `started` has not arrived is `not_started`: the engine answers `{ outcome: 'not_started' }`, which an adapter answers as `not_found` so the caller tries again, as the API does today. Any other reason is `stale`. Both append nothing.
4. Otherwise the machine decides, and the decision is one event, appended with the version the engine read as the expected version: the ledger's load-decide-append loop, which loads and decides again after a version conflict, up to three more times, and then fails with `Conflict`. The engine answers `{ outcome: 'applied' }`.
5. When a snapshot is due, the engine saves one.
6. It dispatches the outputs of every event above the run's dispatch watermark, in the order of the stream, and stops at the first output that fails. The watermark moves to the last event whose outputs were all dispatched.
7. `wake(executionId)` does step 6 again. `sweep()` walks the live runs, wakes each, and has `Timers.sweep` arm again any of the run's armed timers the timer store lost.

## Layers and ports

| Layer         | Folder              | What it holds                                                  | Port                                    |
| ------------- | ------------------- | -------------------------------------------------------------- | --------------------------------------- |
| machine       | `src/machine`       | inputs, state, admission, the clock clamp, limits, the decider | none: pure                              |
| run log       | `src/run-log`       | events, state patches, state formats, the fold, snapshots      | `RunStore` (one Emmett stream per run)  |
| timers        | `src/timers`        | timer ids and what each timer is for                           | `Timers`                                |
| inbox         | `src/inbox`         | the external events a run receives, and their limits           | none: events arrive as `event_received` |
| executor      | `src/executor`      | call keys and call results                                     | `Executor`                              |
| dispatch      | `src/dispatch`      | outputs, the watermark, the order of a dispatch                | `DispatchWatermark`                     |
| serialisation | `src/serialisation` | one input at a time for each run                               | `RunSerialiser`                         |
| settlement    | `src/settlement`    | the record store's settlements and its live runs               | `RecordStore` (the brain's ledger)      |
| engine        | `src/engine`        | the ports together and the engine's own interface              | `WorkflowEngine`                        |

Every port answers with an Effect. None of them is a clock: time comes in with the inputs.

## Inputs

| Input              | Carries                                                                         | Stale when                                               |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `started`          | the document, the input, the limits, the attributes and a seed for random draws | the run has started (`started_before`)                   |
| `timer_fired`      | the timer id                                                                    | the timer is not armed: never armed, fired, cancelled    |
| `call_answered`    | the call key and the result: succeeded, rejected, failed or unreachable         | the call is not open: never started, answered, cancelled |
| `event_received`   | the event, with an `id` of 1 to 256 characters and a `type`                     | the run has received an event with that id               |
| `cancel_requested` | nothing more                                                                    | a cancel was requested before                            |

Every input carries the execution id and `at`. Any input but `started` is `not_started` for a run that has not started and `run_ended` for one that has ended. Two inputs are never taken as stale, because they mean an adapter routed wrongly: an input for another execution, and a second `started` with another document. `staleReasonOf` dies on them with `RunMismatch`.

## The run's log

A run's stream is a state-transition log, not classic event sourcing. Each event records the change an input made to the run's state, as a patch, rather than a domain fact for the fold to interpret. Replaying a run therefore applies patches and evaluates nothing: no expression, no retry arithmetic, no version of the machine's code. A run started under one version of the machine loads under the next. What the events give up in meaning they get back in two fields written for people reading the log.

Each event, `input_applied`, holds:

- `format`: the state format its patch applies to.
- `receipt`: the kind of the input, the key it is deduplicated by and its time; for an answer, the result's status, and for an external event, its type. The input's payload is not stored again: what it changed is in the patch.
- `steps`: each task the input stepped, as `{ reference, run, outcome }`, with outcome `started`, `skipped`, `waiting`, `completed`, `raised`, `timed_out` or `cancelled`.
- `patch`: the change to the state, as JSON Patch operations (RFC 6902 `add`, `replace` and `remove`) addressed by JSON Pointer.
- `outputs`: what the engine must do because of this input.

An input that is stale or not started appends nothing; logging it is the adapter's job.

## Held data and the size of a patch

Values a run holds live once, in the state's value table, `machine.values`: the run's input, the result of a call, the data of an event, the output of an expression. Each value has an id that counts up within the run and is never reused, its size in bytes of UTF-8 JSON, and the number of holders. Frames, list cursors, variables, branches and the context refer to values by id. Passing a value on, as a call's output becomes the cursor's data, the next task's input and the context, adds a holder, not a copy; a value leaves the table when its last holder lets go.

The data a run holds is the sizes of the values in the table, plus 4 KiB for each open frame, plus the document. That bounds the state, and so every snapshot, at 4 MiB of held data. It also bounds a patch: an input adds each value it made once, as `add /machine/values/<id>`, and otherwise moves ids, so a call that answers with 1 MiB gives a patch of about 1 MiB however many places the answer lands.

A transformation can still make more data than it was given. The machine measures each event before the append; one over 1.5 MiB ends the run with a `raised` runtime error, status 500, the ending today's limits give, recorded as a small final event: the outcome, the frames gone, timers and calls cancelled and the execution settled.

Frames never store the document: they name tasks by reference, a JSON Pointer into `workflow.document`.

## State formats

Every event and every snapshot names its state format, `stateFormat`, today 1. A change to the state's schema is a new format, and a new format ships only with an upcaster for snapshots and one for patches. `evolve` applies a patch strictly: an `add` to a member that exists, or a `replace` or `remove` of one that does not, dies with `PatchFailed`, and the result must decode as the state, so a skew between a log and the code that reads it is caught when the run loads, never folded into a wrong state.

## Outputs and receipts

| Output         | Carries                                                       | Idempotent by | Port                 | Receipts                                                                 |
| -------------- | ------------------------------------------------------------- | ------------- | -------------------- | ------------------------------------------------------------------------ |
| `arm_timer`    | timer id, due time, purpose                                   | timer id      | `Timers.arm`         | `armed`, `already_armed`, `refused_after_cancel`                         |
| `cancel_timer` | timer id                                                      | timer id      | `Timers.cancel`      | `cancelled`, `already_fired`, `tombstoned`                               |
| `start_call`   | call key, the function, its arguments, the longest it may run | call key      | `Executor.start`     | `started`, `already_started`, `refused_after_cancel`                     |
| `cancel_call`  | call key                                                      | call key      | `Executor.cancel`    | `cancelled`, `already_answered`, `tombstoned`                            |
| `settle`       | execution id and settlement                                   | execution id  | `RecordStore.settle` | `recorded`, `already_recorded`, `settled_otherwise`, `unknown_execution` |

A cancel for a key the timer store or the executor has never seen is recorded as a tombstone, so a start of that key that arrives later is refused. Answers come back as inputs: a fired timer as `timer_fired`, a finished call as `call_answered`. Every receipt is final; only a failure to answer, `DispatchFailed`, leaves an output to be dispatched again.

The settlement vocabulary is the record store's: `succeeded` with an output, `rejected` with `invalid_input` or `unavailable` and a detail, or `failed`.

The machine checks only the size of a call's arguments, at most 264 KiB as JSON. The executor checks what they mean, such as a primitive, a name and an input, and that a workflow does not call another workflow, and answers `rejected` with reason `invalid_arguments` and a detail when they are wrong. The machine maps a rejection's reason to the task's error through the table the interpreter uses today (`primitives/orchestration/src/interpreter/call-task.ts`), with `invalid_arguments` as a `validation` error, status 400, carrying the executor's detail.

## Idempotency keys

| Key          | Made of                                                   | Deduplicated in                                 |
| ------------ | --------------------------------------------------------- | ----------------------------------------------- |
| execution id | given by the adapter that starts the run                  | the run's status; `RecordStore` by execution id |
| timer id     | `<execution id>/timers/<n>`, n counting up within the run | `state.timers.armed`; `Timers` by id            |
| call key     | execution id, the task's reference, the run of that task  | `state.calls`; `Executor` by `callKeyText(key)` |
| event id     | the external event's own `id`                             | `state.inbox.receivedIds`                       |
| value id     | n counting up within the run                              | `state.machine.values`                          |

A run keeps one counter of runs for each task reference, `state.runs`, so the third time a task runs its run is 3, and a call it starts has that run in its key. An adapter that gives a call its own execution, as a call to a spec has, derives that execution's id from the call key, so a call dispatched twice is one execution.

The event store deduplicates nothing: Emmett appends a message with an id it has seen before as a new message, on SQLite and on D1. Deduplication lives in the run's state.

## The dispatch watermark

The watermark of a run is a stream version. Every output of every event at or below it has been dispatched at least once. A dispatch takes the outputs above it in the order of the stream and stops at the first that fails; the watermark then moves to the last event whose outputs were all dispatched, `dispatchedThrough(watermark, events, firstFailed)`, and never goes down. A crash between the append and the dispatch loses nothing: the outputs are in the event, and the next wake dispatches them.

## Serialisation

One input at a time for each run is the adapter's job. On Cloudflare it is the run's Durable Object, whose single thread takes one request at a time. On Node it is one process for each SQLite file, holding a lock per run in memory; a second process on the same file is outside the contract, and nothing claims or leases a run. A PostgreSQL adapter, later, will take a lease per run. Whatever slips past, the expected version of the append catches.

On Node the timers table goes through the ledger's own SQLite driver or lives in a separate file: written through a second SQLite library to the ledger's file, committed cancels were lost (`spikes/node/results/lost-write-repeat.json` on branch `spike/engine-node`).

## Live runs and the sweep

The live runs are the executions the record store has recorded `started` with `finishesLater` and not yet settled, what `awaitsSettlement` in `@beonauto/specs` answers: `RecordStore.liveRuns()`. On Node that is one query over the one file. `sweep()` walks them; for each it calls `wake`, and `Timers.sweep` with the run's armed timers, which arms again any the timer store lost, such as an alarm of an evicted Durable Object that gave up after its retries.

## State and snapshots

A run's state is plain JSON: no `Map`, `Set`, `Date`, `undefined`, class or function, so `JSON.parse(JSON.stringify(state))` is the state.

A snapshot is `{ format, executionId, version, historyBytes, state }`, the state folded from events 1 to `version`, written only once event `version` is durable; the run store keeps only the latest. A snapshot is due after 1,000 inputs, or once the events since the last snapshot take as many bytes as that snapshot did, and at least 1 MiB, so writing snapshots never costs more bytes than the history it covers.

A snapshot holds at most about 5.3 MiB: the held data (4 MiB: the values, the document and the frames), the events waiting in the inbox (1 MiB), the ids of the events received (1,024 of at most 256 characters), and the timers, calls and run counters, a few dozen bytes for each frame. It is stored in chunks of at most 1 MiB of UTF-8, cut between characters, never inside one. D1 and Durable Object SQLite both take rows of at most 2 MB; a 1 MiB chunk leaves room for the row's other columns, and an event, at most 1.5 MiB, fits in a row too.

## Limits

| Limit                       | Value        | When it is reached                                                  |
| --------------------------- | ------------ | ------------------------------------------------------------------- |
| data a run holds            | 4 MiB        | the run ends, raised, as today                                      |
| one event                   | 1.5 MiB      | the run ends, raised, in a small final event                        |
| arguments of a call         | 264 KiB      | the task raises a validation error                                  |
| tasks in one input          | 100          | the machine arms a timer due at once and goes on when it fires      |
| expression work             | 8,000,000    | for one expression, as today                                        |
| work in one input           | 16,000,000   | as above: a timer due at once, then the rest                        |
| tasks without waiting       | 10,000       | the run ends, raised, as today                                      |
| events waiting in the inbox | 64, 1 MiB    | the run ends, raised, as today                                      |
| events a run receives       | 1,024, 4 MiB | the run ends, raised, as today; it also bounds the ids kept         |
| inputs a run takes          | 100,000      | checked in `decide` from `state.inputs`: the run ends, raised       |
| history                     | 512 MiB      | checked by the engine from the bytes appended: the run ends, raised |

## On the ledger's loop

The engine decides and appends the way the ledger does, with the ledger's own pieces from `@beonauto/ledger`. The run store's append fails with the ledger's `VersionConflict`, and the engine retries it with `retriedOnVersionConflict`, which fails with `Conflict` after three more attempts. The SQLite run store, in the adapters' step, reads a run's tail with `EventStore.read(stream, after)` and appends with `eventAppenderOf`.

## Invariants

Each sentence is something a reviewer can check against the code or a test. **[engine]** marks what this package and the machine guarantee; **[adapter]** marks an obligation of every adapter.

1. **[engine]** A run has exactly one stream, and the stream's version is the number of inputs the run applied.
2. **[engine]** `decide(input, state)` is a pure function of its arguments: it reads no clock, no random source, no locale and no storage, and the same state and input give the same events (`src/engine/portability.test.ts`).
3. **[engine]** Time in a run is only ever an input's clamped `at`; random draws come from the seed in `started` and the number of draws in the state.
4. **[engine]** `evolve(state, event)` applies the event's patch strictly and does nothing else (`src/run-log/run-fold.test.ts`, `src/run-log/state-patch.test.ts`).
5. **[engine]** An applied input appends exactly one event, in one append, with the version the decision was made on as the expected version.
6. **[engine]** A stale input appends nothing, and neither does an input to a run that has not started, nor one that would change nothing.
7. **[engine]** A late answer, a duplicate answer, a second delivery of an event and the fire of a cancelled timer are stale inputs (`src/machine/admission.test.ts`).
8. **[engine]** The deduplication state is bounded: armed timers and open calls are what is outstanding, and a run keeps at most 1,024 event ids.
9. **[engine]** Timer ids and value ids are never reused within a run, and the run counter of a task reference only counts up.
10. **[engine]** The outputs of a run are exactly the `outputs` of its events, and an output is dispatched only after the event that holds it is appended.
11. **[adapter]** Every output is idempotent by its key, so dispatching it twice has the effect of dispatching it once, and a cancel of a key never seen leaves a tombstone that refuses a later start.
12. **[engine]** The watermark never goes down, and every output of every event at or below it has been dispatched at least once (`src/dispatch/dispatch-watermark.test.ts`).
13. **[engine]** A run's outcome is in its stream before the record store is asked to record it, and the `settle` output is dispatched again until the record store answers.
14. **[adapter]** The run log and the record store may be different stores: two writes, each idempotent by execution id, the second retried. An adapter whose two stores are one database may make them one transaction.
15. **[engine]** Loading a run from its latest snapshot and the events after it gives the same state as folding its whole stream (`src/run-log/run-fold.test.ts`).
16. **[adapter]** Only the latest snapshot of a run is kept, in chunks of at most 1 MiB of UTF-8 (`src/run-log/snapshot.test.ts` for the chunks).
17. **[engine]** The state of a run is plain JSON, and the data it holds, measured by size, stays at or under 4 MiB.
18. **[engine]** No event is larger than 1.5 MiB as JSON: the machine measures each event before the append and ends the run instead (`src/run-log/run-event.test.ts`); and no input runs more than 100 tasks.
19. **[adapter]** Inputs of one run are applied one at a time; the machine relies only on the expected version of each append.
20. **[engine]** Nothing in this package uses a Node-only API, a dynamic import or code generation, or imports Temporal (`src/engine/portability.test.ts`).
21. **[engine]** No module of the engine keeps a cache that grows with the history of a run: what an input costs in memory is bounded by the input and the state (`src/engine/portability.test.ts`).
22. **[engine]** No two events of a stream have the same receipt kind and key.
23. **[engine]** `lastInputAt` never decreases (`src/machine/input-receipt.test.ts`).
24. **[engine]** A snapshot at version v is the fold of events 1 to v, and is written only after event v is durable; **[adapter]** the run store writes it only then.
25. **[engine]** A dispatch takes outputs in the order of the stream and stops at the first that fails (`src/dispatch/dispatch-watermark.test.ts`).
26. **[engine]** Every armed timer and every open call has exactly one `arm_timer` or `start_call` and at most one cancel in the stream.
27. **[engine]** An ended run has no armed timers and no open calls.
28. **[engine]** `settle` appears once in a stream, in its last event.
29. **[engine]** A run takes at most 100,000 inputs and 512 MiB of history; the input that would go past either ends the run.
30. **[engine]** Every event and every snapshot names its state format, and one of another format is refused when it is read (`src/run-log/run-event.test.ts`, `src/run-log/snapshot.test.ts`).
31. **[engine]** Every `arm_timer` is due at or after the time of the input that armed it.

## Open design points

- `evolve` decodes the whole state after each patch, so a load costs one decode of the state whatever the tail, and an applied input one more. The machine's step measures that against the 9 ms a fold from a snapshot every 1,000 events took in workerd (`spikes/cloudflare/results/fold.json` on branch `spike/engine-cloudflare`); checking only the patched paths is the fallback.
- A workflow that calls a workflow raises a `configuration` error today and a `validation` error once the executor rejects it with `invalid_arguments`; keeping `configuration` needs a reason of its own.
- The machine needs the DSL, expressions and policy that live in the orchestration primitive today; where the machine itself lives, beside them or with this package, is decided when it is written.
- What replaces Temporal's limits on a run's history is decided here as 100,000 inputs and 512 MiB, both well above what a workflow could reach on Temporal; real use may move them.
