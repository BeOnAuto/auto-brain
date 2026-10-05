# @beonauto/workflow-engine

The contract of the workflow machine that runs on the ledger: the DSL it runs, the state it keeps, the inputs it takes and the ports to the adapters that store, time and execute for it. The machine's state is shaped by the workflow DSL, so this package is the workflow machine's contract, not a generic runtime. It knows workflows, their DSL and an executor that performs calls. It does not know brains, prompts, models, specs or primitives: the functions a workflow may call come from the caller, and whatever an adapter needs to know about a run, such as who started it, it passes as opaque `attributes` and gets back with every output.

The same code runs in Node, where one server keeps every run in one SQLite file, and in Auto's cloud hosting, the hosted runtime, where each run is an isolate of its own. The decision record states what the hosted runtime allows: a single-threaded isolate per run, woken by alarms that fire at least once and are dropped after a bounded number of failed retries, with about 128 MB of memory and bounded CPU per wake-up, no long-lived process and no code generation, and its own SQLite with rows of at most 2 MB; the shared database has no interactive transactions. The machine decides each input (below); the adapters are the next step, and until then the orchestration primitive runs workflows on Temporal, with the DSL code it shares with the machine from here. [The decision record](../../docs/decisions/0001-workflow-engine-on-the-ledger.md) says why.

## Entries

- `@beonauto/workflow-engine`: the contract and the machine, `workflowMachine(options)`, from `src/index.ts`.
- `@beonauto/workflow-engine/testing`: the memory adapter of `src/memory` and its virtual clock, a driver over it, and the probes of the ports' contract that every adapter runs (`src/testing/index.ts`). Neither the entry nor anything it imports takes a Node module or the YAML parser, so a hosted adapter can run the probes (`src/engine/portability.test.ts`).
- `@beonauto/workflow-engine/dsl/<module>`: one module of the DSL, such as `dsl/json` or `dsl/policy`.
- `@beonauto/workflow-engine/limits`: the limits, plain numbers.

The `dsl` and `limits` subpaths are transitional. They are there only so that the orchestration primitive's bundled Temporal workflow code can import the DSL and the limits without taking Effect and the ledger from the main entry, and they go when Temporal goes.

## How a run moves

1. An adapter submits an input for an execution, with `at`, the time on its own clock. The machine never reads a clock. It takes `max(at, lastInputAt)` as the time of the input, and for a fired timer at least the time it was due, so time in a run never goes back however the adapters' clocks drift (`inputTimeOf`).
2. Holding the run's serialisation, the engine runs the ledger's own load-decide-append loop, `decisionLoop` from `@beonauto/ledger`, with a load of its own: the run the engine kept after the input before, when its stream has no event after the version it kept, or else `RunStore.load`, the latest snapshot and the events after it, which `loadedRunOf` folds (`runLoopOf`, and The cache of loaded runs below).
3. `staleReasonOf(state, input)` says whether the input can still change the run. An input to a run whose `started` has not arrived is `not_started`: the engine answers `{ outcome: 'not_started' }`, which an adapter answers as `not_found` so the caller tries again, as the API does today. Any other reason is `stale`. Neither appends anything (`submissionOf`).
4. Otherwise the machine decides, and the decision is one event, appended with the version the loop read as the expected version. After a version conflict the loop loads and decides again, up to three more times, and then fails with the ledger's `Conflict`. The engine answers `{ outcome: 'applied' }`.
5. When a snapshot is due, the engine saves one.
6. It dispatches the outputs of every event above the run's dispatch watermark, in the order of the stream, and stops at the first output that fails. The watermark moves to the last event whose outputs were all dispatched. An event that arms or cancels a timer also notes the run's next due time in the record (`runDueOf`); a note that fails is a dispatch failure too, so the watermark stays where it was, below the stream's version, and the next wake or input dispatches the events again and notes the time (`src/engine/wake.test.ts`). The execution a dispatch is for is the one the input or the wake names, never the loaded state's, so a wake of a run that has no event reads and moves that run's watermark.
7. `wake(executionId)` does step 6 again. `sweep(before)` wakes the runs that are overdue (below).

## Layers and ports

| Layer         | Folder              | What it holds                                                          | Port                                    |
| ------------- | ------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| DSL           | `src/dsl`           | JSON, durations, jq expressions with their work budget, tasks, policy  | none: pure                              |
| machine       | `src/machine`       | inputs, state, held values, admission, the clock, UTC time, draws      | none: pure                              |
| runner        | `src/runner`        | the session of one input, the list and task runners                    | none: pure                              |
| tasks         | `src/tasks`         | each task body: start, resume and cancel over its frame                | none: pure                              |
| decider       | `src/decider`       | the run's lifecycle, its bounds, the patch and outputs of an event     | none: pure                              |
| run log       | `src/run-log`       | events, state patches, state formats, the fold, snapshots              | `RunStore` (one Emmett stream per run)  |
| timers        | `src/timers`        | timer ids and what each timer is for                                   | `Timers`                                |
| inbox         | `src/inbox`         | the external events a run receives                                     | none: events arrive as `event_received` |
| executor      | `src/executor`      | call keys                                                              | `Executor`                              |
| dispatch      | `src/dispatch`      | outputs, the watermark, the order of a dispatch, a run's next due time | `DispatchWatermark`                     |
| serialisation | `src/serialisation` | one input at a time for each run                                       | `RunSerialiser`                         |
| settlement    | `src/settlement`    | settle receipts, due times, troubling receipts                         | `RecordStore`, `RunReporter`            |
| cache         | `src/cache`         | the runs the engine keeps loaded between inputs, bounded               | none                                    |
| engine        | `src/engine`        | the loop on the ledger, the ports together, the engine's interface     | `WorkflowEngine`                        |
| memory        | `src/memory`        | a run store, timers, executor, record store and watermark in memory    | every port, in memory                   |
| testing       | `src/testing`       | a driver over the memory adapter, the ports' probes, run readers       | none                                    |

Every port answers with an Effect. None of them is a clock: time comes in with the inputs, and the sweep is given the time before which a run is overdue.

The settlement and call-result vocabulary lives once, in `@beonauto/operations` (`SettlementSchema`, `CallResultSchema`, `invalidArguments`), beside its `Outcome`. The limits and `DslError` live once, here, and so does the DSL code the interpreter and the machine both run: expressions and templates with their work budget (`dsl/evaluation.ts`), the retry arithmetic (`dsl/retry-policy.ts`), what a switch, a raise, a catch and a timeout decide (`dsl/task-outcomes.ts`), and the errors a call's result and an uncaught error map to (`dsl/raised-error.ts`). The interpreter imports them.

## The DSL

`policyOf(functions)` gives the policy a document is checked against. The caller gives the functions a workflow may call, each with the checks of its arguments, a description of a call for the messages it raises, and the words that explain where a workflow reaches the world and how it starts; the orchestration primitive gives `execute_spec` (`primitives/orchestration/src/document/workflow-functions.ts`). The DSL itself names no function.

Compiled expressions are kept in one cache for the process, of at most 262,144 characters of expression source, letting go of the expression used longest ago: a compiled expression measured 22 to 34 bytes of heap per character of source, so the cache holds at most about 9 MiB, and compiling one again took 10 to 150 µs.

An expression's budget is work, counted in units of one string character by a patch of jq (`patches/@gabrielbryk__jq-ts@1.7.0.patch`), so the machine decides the same way when a history is replayed. Evaluation is synchronous and only a charge of work can stop it, so every operation is charged in proportion to the time it takes: the values it builds or visits, a string used as an object key by its length, a regular expression by its pattern, the instructions it compiles to and the steps of the machine that runs it. A regular expression compiles to at most 4,096 instructions: a counted repeat is compiled into one copy of what it repeats for each count, so nested repeats such as `(((a{100}){100}){100}){40}` would compile to 40 million, which took 1.1 s and 2.4 GB, and one level more exhausted the heap after 15 s. `runExpression` also takes an optional deadline, in milliseconds on a clock its caller gives, since the DSL reads no clock: the meter reads that clock at most once in 4,096 units of work and stops the expression with the error of its work limit once the deadline has passed. The machine gives no deadline, so its budget stays work alone; the deadline is there for a caller that wants a bound in wall-clock time.

## Inputs

| Input              | Carries                                                                         | Stale when                                               |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `started`          | the document, the input, the limits, the attributes and a seed for random draws | the run has started (`started_before`)                   |
| `timer_fired`      | the timer id                                                                    | the timer is not armed: never armed, fired, cancelled    |
| `call_answered`    | the call key and the result: succeeded, rejected, failed or unreachable         | the call is not open: never started, answered, cancelled |
| `event_received`   | the event, with an `id` of 1 to 256 characters and a `type`                     | the run has received an event with that id               |
| `cancel_requested` | nothing more                                                                    | a cancel was requested before                            |

Every input carries the execution id and `at`. Any input but `started` is `not_started` for a run that has not started and `run_ended` for one that has ended. Three inputs are never taken as stale, because they mean an adapter routed wrongly: an input for another execution, and a second `started` with another document or another input. `staleReasonOf` dies on them with `RunMismatch`.

For `send_execution_event`, the API answers an event the run received before (`event_received_before`) with success, since the event is delivered, and an event for a run that has ended (`run_ended`) with `not_found`, as today. A repeated event appends nothing, so it no longer counts toward the 1,024 events and 4 MiB a run takes over its life; under Temporal it did.

## The run's log

A run's stream is a state-transition log, not classic event sourcing. Each event records the change an input made to the run's state, as a patch, rather than a domain fact for the fold to interpret. Replaying a run applies patches and evaluates nothing: no expression, no retry arithmetic, no version of the machine's code. What the events give up in meaning they get back in two fields written for people reading the log.

Each event, `input_applied`, holds:

- `format`: the state format its patch applies to.
- `receipt`: the kind of the input, the key it is deduplicated by and its time; for an answer, the result's status, and for an external event, its type. The input's payload is not stored again: what it changed is in the patch.
- `steps`: each run of a task the input stepped, once, as `{ reference, run, outcome }`, with the outcome it had when the input ended: `started`, `skipped`, `waiting`, `completed`, `raised`, `timed_out` or `cancelled`. A task that starts and finishes in one input records only how it finished, and the steps keep the order the tasks started in.
- `patch`: the change to the state, as JSON Patch operations (RFC 6902 `add`, `replace` and `remove`) addressed by JSON Pointer. A list that grew is patched at the positions it had and appended to, with an `add` at `<list>/-` for each new item, so the ids a run received cost one operation each, not the whole list again; a list that lost items is replaced whole.
- `outputs`: what the engine must do because of this input.

An input that is stale or not started appends nothing; logging it is the adapter's job.

### History bytes

The state counts the bytes of its own history, `historyBytes`: the UTF-8 bytes of every event in the stream as JSON (`eventBytesOf`), the event that sets it included. The machine builds an event, measures it, and adds `replace /historyBytes` with the count before it plus the bytes of the event that carries that operation (`withHistoryBytes`, which solves for the few digits the number adds). So `decide` knows the history before it appends, and bounds it as it bounds inputs. A load checks the count: a state whose `historyBytes` is not the snapshot's count plus the bytes of the events after it is `UnreadableRun`.

Compression is not part of the format. A run store may compress the events and snapshots it keeps; `historyBytes`, and every bound on a history, counts their JSON uncompressed, so the bounds of a run are the same in every store.

## State formats

Every event and every snapshot names its state format; `stateFormat` is 2. A change to the state's schema is a new format, and:

- each event is folded under its own format, and a state that crosses to a newer format is read strictly under the old one and upcast by that format's upcaster (`OlderFormat.read`, `OlderFormat.upcast`) before the next event applies;
- formats never go back within a stream, and a format newer than the code is refused, both when the run loads (`UnreadableRun`);
- `packages/workflow-engine/corpus/format-<n>.json` holds a committed stream and snapshot of every format, which must load to the state it recorded (`src/run-log/corpus.test.ts`). A new format adds its corpus and keeps every older one loading.

Format 2 came with the machine: a frame records when it started and the context it started with, since a task that waits evaluates its `output.as` and its listen filters later with the variables it started with; an armed timer records when it was armed, since a timeout names the milliseconds it allowed; a fork branch can yield before it starts, as a task in a list can; and a failed branch records the order it failed in, since a competing fork that loses every branch raises the first failure. A list always names what it waits for, the task it runs or the timer due at once it yields to, and a loop always holds the list of the iteration it is in, so neither is ever null: the machine only stores a list or a loop that waits. Format 1 is read strictly with its own frozen schema (`src/run-log/format-one.ts`) and upcast: frames start at the last input with the context then, timers were armed at the last input, and failures are ordered as their branches. A format-1 state with a list between its tasks has no format-2 form and does not load; no runtime ever wrote one, since format 1 had no machine.

Patches are never rewritten: a patch applies only to the format it was written for. `evolve` applies a patch strictly, `add` to a member that exists or `replace` and `remove` of one that does not die with `PatchFailed`, and the result must decode as the state with no member the format does not describe (`onExcessProperty: 'error'`), so a skew between a log and the code that reads it is caught when the run loads, never folded into a wrong state.

## Held data and the size of a patch

Values a run holds live once, in the state's value table, `machine.values`: the run's input, the result of a call, the arguments of a call, the data of an event, the output of an expression. Each value has an id that counts up within the run and is never reused, and its size in bytes of UTF-8 JSON. Frames, list cursors, variables, branches, the context and the workflow's input refer to values by id, so passing a value on moves an id, not a copy.

After each decision the machine sweeps the table: a value stays while the frames, the context or the workflow's input reach it, and the others leave with `remove /machine/values/<id>` (`withReachableValuesOnly`). The data a run holds, `heldBytes`, is the bytes of the values reached, plus 4 KiB for each frame, plus the document (`heldBytesOf`); a property test over 400 generated states checks it against the values an independent walk finds. That bounds the state, and every snapshot, at 4 MiB of held data. It also bounds a patch: an input adds each value it made once and otherwise moves ids, so a call that answers with 1 MiB gives a patch of about 1 MiB however many places the answer lands.

A transformation can still make more data than it was given. The machine measures each event before the append; one over 1.5 MiB ends the run with a `raised` runtime error, status 500, the ending today's limits give, recorded as a small final event.

So a value a run holds across a wait or a yield is bounded by one event, not by the 4 MiB a run holds: the event of the input that made the value carries it whole, with the rest of that input's change, and that event holds at most 1,572,864 bytes of JSON. A value larger than that, less the rest of its event, ends the run raised, `An input changed the run by N bytes, more than the 1572864 one event holds`; in the three tasks of `src/decider/run-bounds.test.ts`, a string of 1,570,322 characters is kept across a wait and one character more is not, the rest of the event taking the other 2,542 bytes. A value made and let go of within one input never reaches an event and is not bounded by one. Under Temporal a single value could take the whole of the data a run holds; this is the fourth change tenants see (`docs/decisions/0001-workflow-engine-on-the-ledger.md`).

Frames never store the document: they name tasks by reference, a JSON Pointer into `workflow.document`. A call frame holds the opaque `function` the call names, its `arguments` as a value id, a `label` for people reading the log, and the id of its `call_deadline` timer, which it disarms when it is answered or cancelled; the machine knows nothing of what the arguments mean.

## Outputs and receipts

| Output         | Carries                                                       | Idempotent by | Port                 | Receipts                                                                        |
| -------------- | ------------------------------------------------------------- | ------------- | -------------------- | ------------------------------------------------------------------------------- |
| `arm_timer`    | timer id, due time, purpose, a label                          | timer id      | `Timers.arm`         | `armed`, `already_armed`, `refused_after_cancel`                                |
| `cancel_timer` | timer id                                                      | timer id      | `Timers.cancel`      | `cancelled`, `already_fired`, `tombstoned`                                      |
| `start_call`   | call key, the function, its arguments, the longest it may run | call key      | `Executor.start`     | `started`, `started_again`, `running`, `answered_again`, `refused_after_cancel` |
| `cancel_call`  | call key                                                      | call key      | `Executor.cancel`    | `cancelled`, `already_answered`, `tombstoned`                                   |
| `settle`       | execution id and settlement                                   | execution id  | `RecordStore.settle` | `recorded`, `already_recorded`, `settled_otherwise`, `unknown_execution`        |

Answers come back as inputs: a fired timer as `timer_fired`, a finished call as `call_answered`. Every receipt is final; only a failure to answer, `DispatchFailed`, leaves an output to be dispatched again. A settle receipt of `settled_otherwise` or `unknown_execution` is troubling (`isTroubling`): the engine hands it to `RunReporter.unsettled`, which the adapter logs, as `reportUnsettled` does today.

A call is idempotent by its key in this sense: it is answered at most once. A start for a key the executor has answered delivers the answer again (`answered_again`); a start for a key it is running leaves it running (`running`); a start for a key that is neither, because the host that ran it died, starts it again (`started_again`), as the Node spike's `ensureJob` restarted a call. And every open call is answered eventually: each `start_call` comes with an `arm_timer` of purpose `call_deadline`, due at the input's time plus `longestCallMs`, and when it fires with the call still open the task fails with a `communication` error, status 503, as a call that cannot be reached does today. A dead executor host therefore holds a run for at most `longestCallMs`, not until its 30-day deadline.

Every cancel the timer store or the executor takes for a key that has not fired or been answered is recorded as a tombstone, whether the key was armed, running or never seen, so an arm or a start of that key that arrives later is refused (`refused_after_cancel`). Dispatch takes outputs in the order of the stream, so a start always reaches the port before its cancel; tombstones matter when a dispatch is repeated from a watermark left behind, as a due note that fails leaves it, which sends an arm or a start again after the cancel that followed it, and to an executor that takes work asynchronously, such as from a queue, where a cancel can overtake its start.

The machine checks only the size of a call's arguments, at most 264 KiB as JSON. The executor checks what they mean, such as a primitive, a name and an input, and that a workflow does not call another workflow, and answers `rejected` with reason `invalid_arguments` and a detail when they are wrong. The machine maps a rejection's reason to the task's error through the table the interpreter uses (`callErrorOf` in `src/dsl/raised-error.ts`), with `invalid_arguments` as a `validation` error, status 400, carrying the executor's detail.

## Idempotency keys

| Key          | Made of                                                  | Deduplicated in                                 |
| ------------ | -------------------------------------------------------- | ----------------------------------------------- |
| execution id | given by the adapter that starts the run                 | the run's status; `RecordStore` by execution id |
| timer id     | `<n>`, counting up within the run                        | `state.timers.armed`; `Timers` by run and id    |
| call key     | execution id, the task's reference, the run of that task | `state.calls`; `Executor` by `callKeyText(key)` |
| event id     | the external event's own `id`                            | `state.inbox.receivedIds`                       |
| value id     | n counting up within the run                             | `state.machine.values`                          |

A run keeps one counter of runs for each task reference, `state.runs`, so the third time a task runs its run is 3, and a call it starts has that run in its key. An adapter that gives a call its own execution, as a call to a spec has, derives that execution's id from the call key, so a call dispatched twice is one execution.

The event store deduplicates nothing: Emmett appends a message with an id it has seen before as a new message, on the self-hosted SQLite and on the hosted runtime's shared database. Deduplication lives in the run's state.

## The dispatch watermark

The watermark of a run is a stream version. Every output of every event at or below it has been dispatched at least once. A dispatch takes the outputs above it in the order of the stream and stops at the first that fails; the watermark then moves to the last event whose outputs were all dispatched, `dispatchedThrough(watermark, events, firstFailed)`, and never goes down. A crash between the append and the dispatch loses nothing: the outputs are in the event, and the next wake dispatches them.

## Serialisation

One input at a time for each run is the adapter's job. In the hosted runtime it is the run's isolate, whose single thread takes one request at a time. On Node it is one process for each SQLite file, holding a lock per run in memory; a second process on the same file is outside the contract, and nothing claims or leases a run. A PostgreSQL adapter, later, will take a lease per run. Whatever slips past, the expected version of the append catches.

On Node the timers table goes through the ledger's own SQLite driver or lives in a separate file: written through a second SQLite library to the ledger's file, committed cancels were lost (`spikes/node/results/lost-write-repeat.json` on branch `spike/engine-node`).

## Due runs and the sweep

The record keeps, for each live run, its next due time, the earliest of its armed timers (`RunDue`). The engine writes it while dispatching an event that arms or cancels a timer, idempotent by the event's version, and when a dispatch stops at a failure. A run whose dispatch fell behind is not written down anywhere: its watermark is below the version of its stream, so it has outputs not yet dispatched and is due now, and `DispatchWatermark.behindRuns(limit)` names such runs. On Node, where one SQLite file holds every run, the adapter finds them by joining its watermarks to its streams. In the hosted runtime each run's stream lives in its own isolate, so no table holds every run's version: the hosted adapter must keep a shared index of each run's watermark and stream version, written with every append and every move of the watermark, for `behindRuns` to read. A failed note of the due time is such a failure: the watermark stays below the event, so the run is behind until a dispatch notes its time, whether its alarm fired or was lost. While notes keep failing, every input to the run dispatches again the outputs above the watermark it holds, and the ports, idempotent by key, take them as already done. An adapter learns that a dispatch fell behind from `wake`, whose `dispatchedThrough` is then below `version`. A running run always has a timer armed, its deadline, and its due time noted or its dispatch behind, so it is always due at some time.

`sweep(before)` asks `RecordStore.dueRuns(before)` for the runs due before that time and `DispatchWatermark.behindRuns` for at most 1,024 runs that are behind, those a sweep took longest ago first, each run marked with the time it was taken (the memory watermark counts its hand-outs), so a run left out of one sweep is taken before any run is taken twice (the watermark's probes of `src/testing/store-probes.ts`), and takes only those: for each it calls `wake`, and `Timers.sweep` with the run's armed timers, which arms again any the timer store lost. It folds no other run. The adapter sweeps every minute and passes a time one minute ago, so a run is swept once its timer is a minute late: alarms in the hosted runtime fired 5 ms late at p99, and the one alarm due while its local runtime was stopped fired 15.6 s late when it was restarted (measurements kept in the private repository); Node's timers fired 3.7 ms late at p99 (`spikes/node/results/timers-precision.json` on branch `spike/engine-node`).

## State and snapshots

A run's state is plain JSON: no `Map`, `Set`, `Date`, `undefined`, class or function, so `JSON.parse(JSON.stringify(state))` is the state.

A snapshot is `{ format, executionId, version, historyBytes, state }`, the state folded from events 1 to `version`, written only once event `version` is durable; the run store keeps only the latest. A snapshot is due once the events since the last one take as many bytes as that snapshot did, and at least 1 MiB, so writing snapshots never costs more bytes than the history they cover.

A snapshot holds at most about 5.3 MiB: the held data (4 MiB: the values, the document and the frames), the events waiting in the inbox (1 MiB), the ids of the events received (1,024 of at most 256 characters), and the timers, calls and run counters, a few dozen bytes for each frame. It is stored in chunks of at most 1 MiB of UTF-8, cut by `TextEncoder.encodeInto` at a code point, never inside one; a 5.2 MB snapshot took 4 ms to encode and chunk. The hosted runtime's SQLite takes rows of at most 2 MB; a 1 MiB chunk leaves room for the row's other columns, and an event, at most 1.5 MiB, fits in a row too.

## Limits

| Limit                                 | Value                                       | When it is reached                                                                                                                                           |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data a run holds                      | 4 MiB                                       | the run ends, raised, as today                                                                                                                               |
| one event                             | 1,572,864 bytes                             | the run ends, raised, in a small final event                                                                                                                 |
| a value held across a wait or a yield | 1,572,864 bytes, less the rest of its event | the run ends, raised, as above: the event of the input that made it carries it whole                                                                         |
| arguments of a call                   | 264 KiB                                     | the task raises a validation error                                                                                                                           |
| tasks in one input                    | 100                                         | the machine arms a timer due at once between two tasks and goes on when it fires                                                                             |
| expression work                       | 8,000,000                                   | for one expression: it raises a runtime error, as today                                                                                                      |
| a regular expression                  | 4,096 compiled instructions                 | the pattern is refused with a runtime error jq's `try` can catch, `regex too large`, whether it is in the document or comes from data                        |
| expression deadline                   | none unless its caller gives one            | `runExpression` stops the expression with the error of its work limit; the machine gives none                                                                |
| work in one input                     | 8,000,000, at most 16,000,000               | at 8,000,000 the machine yields between two tasks, as at 100 tasks; past 16,000,000 an expression raises a runtime error, since nothing yields within a task |
| tasks without waiting                 | 10,000                                      | the run ends, raised, as today                                                                                                                               |
| events waiting in the inbox           | 64, 1 MiB                                   | the run ends, raised, as today                                                                                                                               |
| events a run receives                 | 1,024, 4 MiB                                | the run ends, raised, as today; it also bounds the ids kept                                                                                                  |
| inputs a run takes                    | 100,000                                     | checked in `decide` from `state.inputs`: the run ends, raised                                                                                                |
| history                               | 512 MiB                                     | checked in `decide` from `state.historyBytes`: the run ends, raised                                                                                          |
| a call                                | `longestCallMs`                             | its `call_deadline` timer fires: the task fails with a communication error                                                                                   |

The run that reaches the inputs or history bound ends in one more small event, so a stream holds at most 100,001 events and 512 MiB plus that event.

## Invariants

Each sentence is something a reviewer can check against the code or a test. **[engine]** marks what this package and the machine guarantee; **[adapter]** marks an obligation of every adapter.

1. **[engine]** A run has exactly one stream, and the stream's version is the number of inputs the run applied.
2. **[engine]** `decide(input, state)` is a pure function of its arguments: it reads no clock, no random source, no locale and no storage, and the same state and input give the same events (`src/engine/portability.test.ts`, over the machine, its runner, tasks and decider, the run log, the DSL and jq; `src/decider/workflow-machine.test.ts`).
3. **[engine]** Time in a run is only ever an input's time from `inputTimeOf`; random draws come from the seed in `started` and the number of draws in the state.
4. **[engine]** `evolve(state, event)` applies the event's patch strictly and does nothing else (`src/run-log/run-fold.test.ts`, `src/run-log/state-patch.test.ts`).
5. **[engine]** An applied input appends exactly one event, in one append, with the version the decision was made on as the expected version; the loop dies with `SplitDecision` on a decision of more than one event and appends nothing (`src/engine/run-loop.test.ts`).
6. **[engine]** A stale input appends nothing, and neither does an input to a run that has not started (`src/decider/deduplication.test.ts`).
7. **[engine]** A late answer, a duplicate answer, a second delivery of an event and the fire of a cancelled timer are stale inputs (`src/machine/admission.test.ts`, `src/decider/deduplication.test.ts`, `src/tasks/call-task.test.ts`).
8. **[engine]** The deduplication state is bounded: armed timers and open calls are what is outstanding, and a run keeps at most 1,024 event ids, the ids of the events it took; the event past the bound ends the run and is not kept (`src/runner/run-inbox.test.ts`).
9. **[engine]** Timer ids and value ids are never reused within a run, and the run counter of a task reference only counts up.
10. **[engine]** The outputs of a run are exactly the `outputs` of its events, and an output is dispatched only after the event that holds it is appended.
11. **[adapter]** A timer is armed at most once and fires at least once until cancelled; a call is answered at most once, a start of a call neither answered nor running starts it again, and every cancel of a key that has not fired or been answered, seen or not, leaves a tombstone that refuses a later arm or start. A timer id is unique only within its run, so the timer store keys a timer by its run and its id (the probes of `src/testing/port-probes.ts`).
12. **[engine]** The watermark never goes down, and every output of every event at or below it has been dispatched at least once (`src/dispatch/dispatch-watermark.test.ts`); a run whose watermark is below the version of its stream is behind, and a sweep wakes it, whether or not its due time was noted (`src/engine/wake.test.ts`, the watermark's probes of `src/testing/store-probes.ts`).
13. **[engine]** A run's outcome is in its stream before the record store is asked to record it, and the `settle` output is dispatched again until the record store answers (`src/engine/engine.test.ts`).
14. **[adapter]** The run log and the record store are two writes, each idempotent by execution id, the second retried; `EventStore.append` writes one stream, so neither adapter makes them one transaction.
15. **[engine]** Loading a run from its latest snapshot and the events after it gives the same state as folding its whole stream (`src/run-log/run-fold.test.ts`, `src/run-log/corpus.test.ts`, `src/engine/engine.test.ts`, `src/engine/long-run.test.ts`).
16. **[adapter]** Only the latest snapshot of a run is kept, in chunks of at most 1 MiB of UTF-8 (`src/run-log/snapshot.test.ts` for the chunks; the probes of `src/testing/store-probes.ts`).
17. **[engine]** The state of a run is plain JSON, and the data it holds stays at or under 4 MiB (`src/decider/run-bounds.test.ts`).
18. **[engine]** No event is larger than 1.5 MiB as JSON: the machine measures each event before the append and ends the run instead (`src/run-log/run-event.test.ts` for the measure, `src/decider/run-bounds.test.ts`); and no input runs more than 100 tasks (`src/runner/list-runner.test.ts`).
19. **[adapter]** Inputs of one run are applied one at a time; the machine relies only on the expected version of each append.
20. **[engine]** Nothing in this package, nor jq, uses a Node-only API, a dynamic import, code generation or a host timer, or imports Temporal (`src/engine/portability.test.ts`).
21. **[engine]** No module of the engine keeps a cache that grows with the history of a run; the one cache of the process, compiled expressions, is bounded, and so is each engine's cache of loaded runs, by runs and by bytes (`src/engine/portability.test.ts`, `src/dsl/bounded-cache.test.ts`, `src/cache/run-cache.test.ts`).
22. **[engine]** No two events of a stream have the same receipt kind and key (`src/decider/deduplication.test.ts`).
23. **[engine]** `lastInputAt` never decreases, and a fired timer's input is never earlier than the time it was due (`src/machine/input-receipt.test.ts`).
24. **[engine]** A snapshot at version v is the fold of events 1 to v, and is written only after event v is durable; **[adapter]** the run store writes it only then.
25. **[engine]** A dispatch takes outputs in the order of the stream and stops at the first that fails (`src/dispatch/dispatch-watermark.test.ts`).
26. **[engine]** Every armed timer and every open call has exactly one `arm_timer` or `start_call` and at most one cancel in the stream; a timer an input arms and cancels, or a call it starts and cancels, appears in none of its outputs, so the ports never see it (`src/decider/run-events.test.ts`).
27. **[engine]** An ended run has no armed timers and no open calls (`src/decider/open-calls.test.ts`).
28. **[engine]** `settle` appears once in a stream, in its last event (`src/decider/run-lifecycle.test.ts`).
29. **[engine]** A run takes at most 100,000 inputs and 512 MiB of history, both checked in `decide` from the state; the input that would go past either ends the run (`src/decider/run-bounds.test.ts`).
30. **[engine]** Every event and every snapshot names its state format; formats never go back within a stream, a format newer than the code is refused, and a committed corpus of every format loads (`src/run-log/run-fold.test.ts`, `src/run-log/corpus.test.ts`).
31. **[engine]** Every `arm_timer` is due at or after the time of the input that armed it, and the armed timer records that time.
32. **[engine]** `state.historyBytes` is the bytes of the stream's events as JSON, and a load dies when it is not (`src/run-log/run-event.test.ts`, `src/run-log/run-fold.test.ts`).
33. **[engine]** Every open call has an armed `call_deadline` timer due no later than its start's time plus `longestCallMs`, so every open call is answered, and no `call_deadline` timer stays armed once its call is closed (`src/decider/open-calls.test.ts`).
34. **[engine]** After a decision the value table holds exactly the values the frames (their contexts included), the context and the workflow's input reach, and `heldBytes` is their bytes, 4 KiB a frame and the document (`src/machine/held-values.test.ts`).
35. **[engine]** A troubling settle receipt is reported, never dropped (`src/engine/engine.test.ts`).

## The machine

`workflowMachine(options)` is the run's decider. It is given the functions a workflow may call and the runtime its expressions see as `$runtime`, and `decide(input, state)` gives the one event an input makes.

- A decision opens a session over the state (`src/runner/session.ts`): the value table, the armed timers, the open calls, the inbox, the run counters, a meter of the input's work and a journal of its steps and outputs. The event's patch is the difference between the state before and the state the session ends with (`src/decider/state-diff.ts`), so nothing writes the patch by hand.
- A run is a tree of frames, one for each task that waits, under the root list. An input becomes a signal, a timer fired, a call answered or events arrived, passed down the tree; the frame whose timer, call or listen it is resumes, and the others stay as they are.
- A task starts as soon as its list reaches it, and finishes in the same input unless it waits: on a timer (a wait, a retry's delay, an attempt's limit, a timeout), on a call or on events. A list that ran 100 tasks, or 8,000,000 units of expression work, in one input arms a timer due at once and goes on when it fires (`src/runner/list-runner.ts`).
- `started` arms the run's deadline, due when the run has run the most it may, `mostDurationMs`; its fire ends the run `overran`. A call arms its `call_deadline` and keeps its id. A cancel, an end or a timeout cancels what the frames under it wait for, and a task that raises before it waits disarms its own timeout.
- An event leaves out a timer or a call that the same input opened and closed (invariant 26), and its other outputs keep the order the session emitted them in.
- A run ends with its outcome, settled once in its last event. An input that would pass a bound (inputs, history, held data, the size of one event) ends the run, raised, in a small event of its own.
- The machine's tests run it through the memory driver of `src/testing`; each piece of the design has one that fails without it. The orchestration primitive runs through this driver the 122 of its interpreter's tests that run a workflow and pass on the machine, skipping 13 whose reasons its README gives, and replays its 15 recorded input logs through the machine (`primitives/orchestration/input-logs/`).

## The cache of loaded runs

Each engine keeps the runs it loaded between their inputs (`src/cache/run-cache.ts`), so an input does not load again the snapshot and the events the input before it left. A kept run is the state, the version and the bytes since its snapshot that the decision of the last input gave, and it is used only while its stream has no event after that version: the engine asks the run store for the events after it, and a run whose stream moved on, written by another process or by an append whose answer was lost, is loaded from the store again (`src/cache/cached-inputs.test.ts`).

- An append that fails, a conflict or an outcome the store never told, lets go of the kept run, so the retry after a conflict, and the next input after a lost answer, load the run from the store (`src/cache/kept-runs.test.ts`).
- A kept run counts the bytes of the events since the snapshot the store holds, and a saved snapshot lets go of it, so the next load reads the snapshot's bytes as the store keeps them and each snapshot is written when it is due (`src/cache/cached-snapshots.test.ts`).
- The cache keeps at most 1,024 runs and 64 MiB of the data they hold (`heldBytes` and the bytes of the events waiting in their inboxes), letting go of the run used longest ago (`runCacheBounds`); a run that alone holds more is not kept. An adapter can give its engine a cache of other bounds.
- The machine never writes to a state in place: the memory driver keeps every run frozen to its leaves, so every test that drives a run, the orchestration primitive's on the machine and its recorded input logs among them, decides each input on a frozen state, where a write throws (`src/testing/frozen-runs.ts`, `src/cache/kept-runs.test.ts`).

## Measurements

`pnpm --filter @beonauto/workflow-engine measure` measures, outside the tests (`measure.ts`, with its parts in `measure/`), a loop that waits a second, counts and goes round again. Each row says what it measures: the machine alone, `decide` and `evolve` called in turn on a state kept in memory; a load, a snapshot and the events after it decoded and folded; or the engine over the memory ports, with its store, dispatch, snapshots and cache. Measured on Node 26.10.0; Temporal's figures are the spike's (`spikes/node/results/replay.json` on branch `spike/engine-node`) and the orchestration's replay test.

| What                                             | Measured                                                                                                 | The machine                                                                                                  | Temporal                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 40,000 inputs of the loop                        | the machine alone: `decide`, then `evolve` of its event                                                  | 3.42 s, 11,700 inputs a second, 85 µs an input                                                               | replayed in 4.6 s                                              |
| 10,000 inputs of the loop                        | the engine, the run kept between its inputs                                                              | 1.35 s, 0.14 ms an input                                                                                     |                                                                |
| the same 10,000 inputs                           | the engine with no cache, the run loaded for every input                                                 | 50.68 s, 5.07 ms an input                                                                                    |                                                                |
| a load of the run                                | a snapshot of 1,697 bytes and the events after it                                                        | 0.012 ms with no event after it, 0.81 ms with 46, 9.97 ms with 579, the most before the next snapshot is due |                                                                |
| the run resumed after its 40,000th input         | a load of its last snapshot and the events after it                                                      | 7.38 ms at the median, with 427 events after the snapshot                                                    |                                                                |
| the 40,000 events folded cold                    | a load with no snapshot                                                                                  | 0.69 s, 17.3 µs an event                                                                                     |                                                                |
| the history of those 40,000 inputs               | the bytes of their events as JSON                                                                        | 68.81 MiB, 1,804 bytes an input                                                                              | 9.26 MiB                                                       |
| `decide`, at the median                          | the machine alone, on a run waiting for the input                                                        | started 48 µs, timer 45 µs, answer 19 µs, event 19 µs, cancel 12 µs                                          |                                                                |
| a snapshot of a run holding 1,000,000 characters | its bytes                                                                                                | 1,001,565                                                                                                    |                                                                |
| memory                                           | the heap of each live run between inputs, measured once before the cache, not by the script              | 3.7 KB                                                                                                       | up to 103 MiB retained replaying the 40,000                    |
| the 15 recorded paths                            | replayed through `decide`, and run through the driver, measured once before the cache, not by the script | 2.3 ms in all, and 7.4 ms                                                                                    | replayed in 556 ms, the workflow bundle built in the same test |

An input to a run the engine keeps costs its decision, one fold and the engine's writes: 0.14 ms an input through the memory ports, against 5.07 ms when every input loads the run, a cost that grows with the events since the last snapshot. A run the cache let go of, or one that moved on in its store, costs one load, at most 9.97 ms for this loop.

The tests assert behaviour at the smallest size that proves it and measure nothing: `src/engine/long-run.test.ts` resumes a run of 3,000 inputs from its last snapshot, and no test of the engine is given more than 60 s.

## Open design points

- A history takes about seven times the bytes Temporal's did: 1,804 bytes an input for the loop above, against 243, down from 2,206 before a step was recorded once for each run of a task, a grown list was appended to and a timer id lost its execution id. Its 20,001st event is 1,810 bytes: 18 patch operations (1,282 bytes: the list's data and the frame's run, start, inputs and timer, three run counters, a value in and a value out, a timer in and a timer out, and the counters of the state), four steps (245 bytes), an `arm_timer` (153 bytes) and the receipt (55 bytes). Within 512 MiB a run of 100,000 such inputs takes 172 MiB, so no bound moves. The patch stays RFC 6902, so what remains to shrink it is a store that compresses what it keeps (see History bytes).
- `evolve` decodes the whole state after each patch, about 17 µs an event over the 40,000 inputs above: a cold fold of all of them took 0.69 s, and a load with the most events a snapshot leaves after it, 579, took 9.97 ms, against the 9 ms a fold from a snapshot every 1,000 events took in the hosted runtime (measurements kept in the private repository). With the cache of loaded runs an input folds one event, and only a run loaded again pays for its tail, so checking only the patched paths is not needed yet.
- What replaces Temporal's limits on a run's history is decided here as 100,000 inputs and 512 MiB, both well above what a workflow could reach on Temporal; real use may move them.
