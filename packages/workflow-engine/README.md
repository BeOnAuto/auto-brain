# @beonauto/workflow-engine

The core of the workflow engine that runs on the ledger: the contract between the machine that runs a workflow and the adapters that store, time and execute for it. It knows workflows, the inputs a run takes and an executor that performs calls. It does not know brains, prompts, models or specs: whatever an adapter needs to know about the run, such as who started it, it passes as opaque `attributes` and gets back with every output.

The same code runs in Node, where one server keeps every run in one SQLite file, and in workerd, where each run is a Durable Object. This package holds the contract: the types, the ports, the idempotency keys, the dispatch watermark and the invariants below. The machine that decides an input is the next step, and the adapters the one after; until then the orchestration primitive runs workflows on Temporal, unchanged. [The decision record](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) says why.

## How a run moves

1. An adapter submits an input for an execution, with `at`, the time on its own clock. The machine never reads a clock.
2. Holding the run's serialisation, the engine loads the run: its latest snapshot and the events after it, folded with `evolve`.
3. It asks the decider. A stale input, or one that changes nothing, appends nothing. Otherwise the decision is one event, appended with the version the engine read as the expected version. This is the load-decide-append loop of `@beonauto/ledger`: a version conflict loads the run again and decides again, up to three more times.
4. When a snapshot is due, the engine saves one.
5. It dispatches the outputs of every event above the run's dispatch watermark, in the order of the stream, and then moves the watermark up to the last event whose outputs were all dispatched.
6. `wake(executionId)` does step 5 again. An adapter wakes a run after a crash, on a restart, and from a sweep that finds runs whose watermark is behind their stream.

## Layers and ports

| Layer         | Folder              | What it holds                                         | Port                                    |
| ------------- | ------------------- | ----------------------------------------------------- | --------------------------------------- |
| machine       | `src/machine`       | inputs, state, staleness, limits, the decider's type  | none: pure                              |
| run log       | `src/run-log`       | the run's events, its state patches, snapshots        | `RunStore` (Emmett, one stream per run) |
| timers        | `src/timers`        | timer ids and what each timer is for                  | `Timers`                                |
| inbox         | `src/inbox`         | the external events a run receives, and their limits  | none: events arrive as `event_received` |
| executor      | `src/executor`      | call keys and call results                            | `Executor`                              |
| dispatch      | `src/dispatch`      | outputs and the dispatch watermark                    | `DispatchWatermark`                     |
| serialisation | `src/serialisation` | one input at a time for each run                      | `RunSerialiser`                         |
| settlement    | `src/settlement`    | the settlement of a run and the store that records it | `RecordStore` (the brain's ledger)      |
| engine        | `src/engine`        | the ports together and the engine's own interface     | `WorkflowEngine`                        |

Every port answers with an Effect. None of them is a clock: time comes in with the inputs.

## Inputs

| Input              | Carries                                                                         | Stale when                                                    |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `started`          | the document, the input, the limits, the attributes and a seed for random draws | the run has started before                                    |
| `timer_fired`      | the timer id                                                                    | the timer is not armed: never armed, already fired, cancelled |
| `call_answered`    | the call key and the result: succeeded, rejected, failed or unreachable         | the call is not open: never started, answered, cancelled      |
| `event_received`   | the event, with an `id` of 1 to 256 characters and a `type`                     | the run has received an event with that id                    |
| `cancel_requested` | nothing more                                                                    | a cancel was requested before                                 |

Every input carries the execution id and `at`. Any input but `started` is stale for a run that has not started, has ended, or is another execution. `isStale(state, input)` is this table.

## Events

A run's stream holds one kind of event, `input_applied`:

- `receipt`: the kind of the input, the key it is deduplicated by and its `at`. The input's payload is not stored again: what it changed is in the patch.
- `patch`: the change the input made to the run's state, as JSON Patch operations (RFC 6902: `add`, `replace`, `remove`) addressed by JSON Pointer.
- `outputs`: what the engine must do because of this input.

`evolve` applies the patch and nothing else, so replaying a run never evaluates an expression and never depends on the version of the machine that decided it.

## Outputs

| Output         | Carries                                                                            | Idempotent by | Port                 |
| -------------- | ---------------------------------------------------------------------------------- | ------------- | -------------------- |
| `arm_timer`    | timer id, due time, purpose                                                        | timer id      | `Timers.arm`         |
| `cancel_timer` | timer id                                                                           | timer id      | `Timers.cancel`      |
| `start_call`   | call key, the call as the document names it, its arguments, the longest it may run | call key      | `Executor.start`     |
| `cancel_call`  | call key                                                                           | call key      | `Executor.cancel`    |
| `settle`       | execution id and settlement: succeeded, rejected or failed                         | execution id  | `RecordStore.settle` |

Answers come back as inputs: a fired timer as `timer_fired`, a finished call as `call_answered`. `RecordStore.settle` answers `recorded`, `already_recorded`, `settled_otherwise` or `unknown_execution`; each of them is final, and only a failure to answer leaves the output to be dispatched again.

## Idempotency keys

| Key          | Made of                                                   | Where it is deduplicated                             |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------- |
| execution id | given by the adapter that starts the run                  | the run's status; `RecordStore` by execution id      |
| timer id     | `<execution id>/timers/<n>`, n counting up within the run | `state.timers.armed`; `Timers` by id                 |
| call key     | execution id, the task's reference, the run of that task  | `state.calls.open`; `Executor` by `callKeyText(key)` |
| event id     | the external event's own `id`                             | `state.inbox.receivedIds`                            |
| snapshot     | execution id and stream version                           | the run store keeps only the latest                  |
| watermark    | execution id                                              | the watermark store                                  |

The event store does not deduplicate anything: Emmett appends a message with an id it has seen before as a new message, on SQLite and on D1. Deduplication lives in the run's state.

## The dispatch watermark

The watermark of a run is a stream version. Every output of every event at or below it has been dispatched at least once. Outputs above it are dispatched on the next submit or wake, in the order of the stream, and the watermark then moves up to the last event whose outputs were all dispatched. A crash between the append and the dispatch loses nothing: the outputs are in the event, and the next wake dispatches them.

## State and snapshots

A run's state is plain JSON: no `Map`, `Set`, `Date`, `undefined`, class or function, so `JSON.parse(JSON.stringify(state))` is the state. It holds the run's definition and attributes, the machine's frames and context, the armed timers and open calls, the inbox, the random draws made so far, the cancel request and, once the run ends, its outcome.

A snapshot is `{ format, executionId, version, state }`, the state folded from the events up to `version`. It is due after 1,000 inputs or 1 MiB of events since the last one, whichever comes first. It is stored in chunks of at most 65,536 UTF-16 code units, at most 192 KiB in UTF-8 each, cut between characters, never inside one; the run store keeps only the latest snapshot.

## Limits

| Limit                       | Value        | Why                                                                              |
| --------------------------- | ------------ | -------------------------------------------------------------------------------- |
| data a run holds            | 4 MiB        | measured by size, not by object identity; it bounds the state, so every snapshot |
| one event                   | 1.5 MiB      | a call may answer with 1 MiB; D1 and Durable Object rows take up to 2 MB         |
| tasks in one input          | 100          | then the machine arms a timer due at once and goes on when it fires              |
| tasks without waiting       | 10,000       | as the interpreter has it                                                        |
| events waiting in the inbox | 64, 1 MiB    | as the interpreter has it                                                        |
| events a run receives       | 1,024, 4 MiB | as the interpreter has it; it also bounds the event ids kept for deduplication   |

The 16 MiB a run could hold on Temporal comes down to 4 MiB, and snapshots are chunked: a snapshot is then at most about 5 MiB in chunks of at most 192 KiB. Bringing the limit under 1 MiB instead would break what callers rely on today: a call answers with up to 1 MiB, and a workflow's output may take 1 MiB. Temporal's limits on history, 40,000 events and 8 MiB, go: a run is loaded from its snapshot, so the length of its history no longer costs time.

## Invariants

Each sentence is something a reviewer can check against the code or a test.

1. A run has exactly one stream, and the stream's version is the number of inputs the run applied.
2. `decide(input, state)` is a pure function of its arguments: it reads no clock, no random source and no storage, and the same state and input give the same events.
3. Time in a run is only ever an input's `at`; random draws come from the seed in `started` and the number of draws in the state.
4. `evolve(state, event)` applies the event's patch and does nothing else.
5. An applied input appends exactly one event, in one append, with the version the decision was made on as the expected version.
6. A stale input appends nothing, and neither does an input that would change nothing.
7. A late answer, a duplicate answer, a second delivery of an event and the fire of a cancelled timer are stale inputs.
8. The deduplication state is bounded: armed timers and open calls are what is outstanding, and a run keeps at most 1,024 event ids.
9. Timer ids are never reused within a run, and a call key's run counts up for each reference.
10. The outputs of a run are exactly the `outputs` of its events, and an output is dispatched only after the event that holds it is appended.
11. Every output is idempotent by its key, so dispatching it twice has the effect of dispatching it once.
12. The watermark never goes down, and every output of every event at or below it has been dispatched at least once.
13. A run's outcome is in its stream before the record store is asked to record it, and the `settle` output is dispatched again until the record store answers.
14. The run log and the record store may be different stores: the contract assumes two writes, each idempotent by execution id, the second retried. An adapter whose two stores are one database may make them one transaction.
15. Loading a run from its latest snapshot and the events after it gives the same state as folding its whole stream.
16. Only the latest snapshot of a run is kept, and no stored chunk of it is longer than 65,536 UTF-16 code units.
17. The state of a run is plain JSON, and the data it holds, measured by size, stays at or under 4 MiB.
18. No event is larger than 1.5 MiB as JSON, and no input runs more than 100 tasks.
19. The machine never assumes it is the only writer: it relies only on the expected version of each append. Serialising the inputs of one run is the adapter's job.
20. Nothing in this package uses a Node-only API, generates code, or imports Temporal (`src/engine/portability.test.ts`).
21. No module of the engine keeps a cache that grows with the history of a run: what an input costs in memory is bounded by the input and the state.

## Open design points

- Whether an event may reach a run before its `started` input: the contract calls it stale, so an adapter must deliver events only to a started run.
- Whether the arguments of a `call` are checked by the machine, as the interpreter checks a spec call today, or by the executor, which would answer `rejected`. The engine itself does not know specs.
- The 1 MiB snapshot interval with a 4 MiB state can write up to four bytes of snapshot for each byte of history.
- What replaces Temporal's limits on history, if anything, now that a run's history no longer costs time to load.
