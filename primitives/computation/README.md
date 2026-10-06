# @beonauto/computation

The implementation of computation functions. A computation function is a program in jq with schemas for its input and output; a run applies the program to its input and answers with exactly one output, the same for the same input on every host of the same image, within bounds on its work, the values it builds, its time and its memory. Its API identifier and package name are `computation`. [Decision 0005](../../docs/decisions/0005-computation-functions.md) says why it exists and how it is bounded.

User documentation is [Computation function format](../../docs/reference/computation-format.md), published at [on.auto/docs](https://on.auto/docs/): the document, the dialect, the number rules, the endings and the bounds. Update it alongside behaviour changes.

## The document

`parseComputationDocument(source)` reads a document with the shared reader of [`@beonauto/specs/document`](../../packages/specs/README.md#reading-function-documents) and gives a `ComputationFunctionDefinitionDocument`: an optional `description`, the `language`, `jq`, the compiled `input.schema` and `output.schema` when the document has them, the `program` and the line it starts on. The front matter's keys are `description`, `language`, `input.schema` and `output.schema`; every other key, `model`, `config`, `tools`, `output.format` and `input.default` among them, is an issue at its line, and the message for empty front matter names `the language`. A schema is compiled with the reader's compiler and validates values nested at most 512 levels.

The program is compiled with the evaluator of [`@beonauto/workflow-engine/dsl`](../../packages/workflow-engine/README.md#programs) and the dialect of `src/document/program-dialect.ts`, which refuses, each with its reason, `now`, `env`, `$ENV`, `input`, `inputs`, `input_filename`, `input_line_number`, `$__loc__`, `builtins`, `localtime`, `strflocaltime`, `debug`, `stderr`, `halt`, `halt_error`, `label` and `break`, and binds no variable, so every `$name` the program does not bind is refused too. The evaluator's issues carry spans into the body, which become lines of the document: `Line 4: The program nests more than 128 levels deep`. Parsing checks everything a run can be refused for without its input.

## A run

`makeComputationFunctionAdapter({ pool, deadlineMs })` makes the primitive for `makeSpecOperations`; the server gives it a `ProgramPool` of the engine, with `COMPUTATION_WORKERS` workers. `deadlineMs` is 10,000 unless a test gives less, and is the primitive's `longestExecutionMs`. The primitive reaches nothing outside and changes nothing there, calls no tools, and is stopped when its call is cancelled. An execution:

1. refuses an input nested deeper than 512 levels, and one its input schema refuses, as `invalid_input` with the schema's pointers;
2. asks the pool to run the program on the input with `computationLimits`, `liftedLimits` of the engine with the work bound, in `exactly one` mode, with the deadline counted from the start of the run and an output of at most `mostOutputBytes`, 1 MiB less 256 bytes for the record;
3. for a definition with an output schema, names its own worker module, `src/run/output-worker.ts`, and the schema as the request's context, so the worker that runs the program also checks the output against the schema, under the run's deadline, and the thread that serves requests never waits on the check: a 1 MiB output against a recursive schema had taken 1,038 ms there;
4. turns the outcome into the run's ending (`src/run/run-outcome.ts`):

| Outcome of the pool                                                           | Ending                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| answered, the output schema, if any, accepting it                             | succeeded, with the output and the record `{ language, work, duration_ms, input_bytes, output_bytes }`                                                           |
| mismatched: its worker found the output does not match the output schema      | `conflict`, kind `unworkable`, with the first three issues, each cut at 1,024 bytes                                                                              |
| raised                                                                        | `conflict`, `unworkable`: `The program raised an error on line N: <its error>`, its text cut at 1,024 bytes, or for `Max depth exceeded` the depth of evaluation |
| exhausted by work or by the depth of a value                                  | `conflict`, `unworkable`, with the bound, the line and, for work, the units spent                                                                                |
| no output or more than one, an output that is not JSON, or one over its bytes | `conflict`, `unworkable`                                                                                                                                         |
| exhausted by the deadline, or stopped by the deadline, memory, no free worker | `unavailable`, with words that name the bound or the number of workers                                                                                           |
| stopped because the call was cancelled or the server is stopping              | `unavailable`; the operations record the cancelled run as `failed`                                                                                               |
| crashed, or refused by a worker although the definition was accepted          | a defect: the call fails with an incident and the run is `failed`                                                                                                |

A `conflict` of the kind `unworkable` is recorded with its kind, so the run, the listing and the history show it, and a workflow sees a `runtime` error of status 409 with that kind, which a retry policy matching 503 leaves alone. The words of a run that succeeded say `Its result: ...` from the output, or that it is too long to repeat.

## Bounds

`computationBounds` holds them: 64,000,000 units of work, a deadline of 10,000 ms, a heap of 256 MiB, 4 workers by default, a value depth of 512 and a depth of evaluation of 10,000; the engine adds the syntax bound of 128 levels and the worker's stack of 64 MiB. Each bound has a test that reaches it and ends as [the reference](../../docs/reference/computation-format.md#bounds) says (`src/run/run-endings.test.ts`, and the server's `src/computation` for the deadline over HTTP, a busy pool and a crash). Tests that start workers have 30 seconds, and assert wall-clock time only as a lower bound.

The hosted runtime does not offer computation functions until its adapter bounds the time and the memory of a run. Its isolates have no threads, and nothing interrupts a synchronous evaluation there but the charge of work, so a run that stalls in one native operation could not be stopped at its deadline, nor one that allocates be stopped at its memory. The server here bounds both with a worker thread for each run, terminated at the deadline and limited in its heap.

## Measurements

`pnpm --filter @beonauto/computation measure` measures, outside the tests (`measure.ts`, with its parts in `measure/`), the work of the example by its rows, the most rows its input takes, the time each of 32 charged constructs takes to spend a run's work, a worker's start and end, a worker stopped at its deadline, the deepest recursion within the bound and without it, and the heap of a worker after runs that allocate much. On Node 26.10.0 on an Apple M4 Max, 16 cores and 128 GiB:

| What                                                         | Measured                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| the example's work                                           | 1,939,824 units for 1,000 rows, 3,857,976 for 2,000, 7,694,800 for 4,000                                                        |
| the example at the most rows its input takes                 | 3,911 rows, 262,092 bytes: 7,533,024 units, 4.0 ms at the median on the measuring thread                                        |
| a run's 64,000,000 units, by the slowest constructs          | updating an object 414 ms, merging objects 354 ms, listing entries 257 ms, the regex machine 196 ms; every other 142 ms or less |
| a run of a program that answers at once                      | 27.5 ms at the median of 30, the worker started and ended                                                                       |
| a worker that never answers, under a deadline of 500 ms      | stopped after 500.9 ms                                                                                                          |
| recursion of `def g: if . == 0 then 0 else (. - 1 \| g) end` | 1,999 calls within 10,000 levels; 26,711 in the 64 MiB stack with no bound                                                      |
| a worker's heap after allocating runs                        | 147.4 MiB at most, of 256                                                                                                       |

Under a load average of 55 on the same machine, the same script measured the slowest construct at 4,607 ms and the example at 42.3 ms, and the deadline of 10 seconds leaves room for a host that busy.

Each run starts a worker of its own and ends it with the run, so nothing one run leaves in a worker reaches the next and a worker terminated at its deadline never has to be replaced; that costs 27.5 ms a run at the median, most of it the worker stripping the types of its modules as it loads them. If that time matters, a pool that keeps warm workers between runs is the next step.

## Testing

`@beonauto/computation/testing` exports `campaignPace`, the example document, `campaignRows(count)`, an input of that many rows over four campaigns, and `scriptedPool(script, otherwise)`, a pool that answers with the outcomes of its script in turn and then hands runs to `otherwise`, for the tests of the server that need an outcome a real worker gives only rarely. The tests of this package run real workers; the cents of the example are checked against a computation in big integers over 1,000 rows.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/document` holds the document: its type, the front matter's keys, the dialect and parsing. `src/run` holds a run: its bounds, the input's checks, the call of the pool and the endings. `src/primitive` holds the primitive and its description for agents. `src/testing` holds the example, the scripted pool and what the tests share.
