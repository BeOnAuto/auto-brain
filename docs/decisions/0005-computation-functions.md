# 0005 — Computation functions: a brain computes with a program, deterministically and without the outside world

**Status:** proposed (2026-10-05), revised twice after audit by 2026-10-06; built 2026-10-06, with the amendments at the end

## Context

A brain reasons, interacts, computes, recalls and predicts, and coordinates those functions through workflows. Today it reasons and coordinates; the computation primitive is a folder with nothing in it, and the public documentation lists a computation function as planned: "a calculation, transformation or other deterministic operation".

The need is concrete. The predecessor platform learned that a model must never do the arithmetic: a campaign projected far under its budget was told to spend less, and a run called a pace "1.14x under". It kept every calculation in hand-written code beside its tools, with arbitrary-precision decimals, loops over any amount of data and libraries, and a separate pipeline of built statistical artefacts, forecasts and elasticities, in a workspace; none of it could be changed by anyone but a developer, and none of it was versioned with the agent that used it. Here a workflow reads figures through an MCP server, and a reason function writes the words; between them a step must turn rows into totals, paces and projections exactly, every time, and that step must be a brain function a user saves, versions and runs like any other.

What exists to build on: specs of every primitive share one registry, which takes a new primitive with its media type, parse, noun and words and needs no change; one document model; versions; `execute_spec`, which any workflow may call for any primitive but orchestration, with the format's own retry and timeout rules; `get_execution`, the run list and history; plain words and presenters; and a run whose output with its record exceeds 1 MiB ends as `failed` unless the primitive measures it first. A reason function is a Markdown document with Dotprompt front matter, `description`, `input.schema`, `output.schema`, and a body; its reader, its document split and its schema checks live inside the inference primitive, whose front matter requires `model` and refuses other keys, and are not exported.

The workflow format evaluates expressions in a dialect of jq, implemented by a library we patch to meter work in units and stop at a budget. The evaluator is not exported from the engine, injects `now`, refuses only the two local-time functions at save, does not check variable names so `$ENV` and `$__loc__` fail at run time, keeps the first of several outputs and turns none into `null`, cuts an error message after the program's source, and runs with limits of its own beside the budget: 10,000 values produced, 200,000 steps, a depth of 200, under which the record's first example failed at 3,000 rows, `reduce` at 2,500 items and a recursion at 38 levels. Evaluation is synchronous on the server's event loop and nothing outside the work charge can interrupt it; an audit found that a counted-repeat regular expression costs no work and can exhaust the heap, and that a huge string used as an object key burns eleven seconds for sixteen million units; both are being fixed in the evaluator for workflows now, with work charged per compiled instruction and a deadline inside the charge. Numbers are IEEE-754 doubles: `[0.1, 0.2, 0.3] | add` is 0.6000000000000001, integers are exact to 2^53, and there is no decimal type. The dialect deviates from jq in known places: `unique` does not sort, `to_entries` sorts keys, strings compare by UTF-16 code unit, `label`/`break` are broken, regular expressions have no lookahead or backreferences. A JavaScript stack overflow is not a jq error and its depth depends on the host.

## Decision

### 1. A computation function is a program in a document of the same shape as a reason function

```markdown
---
description: Spend, pace and projection per campaign, in cents, for a reporting period
language: jq
input:
  schema:
    type: object
    required: [rows, period]
    properties:
      rows:
        {
          type: array,
          items:
            {
              type: object,
              required: [campaign, cost_cents, budget_cents],
              properties:
                { campaign: { type: string }, cost_cents: { type: integer }, budget_cents: { type: integer } },
            },
        }
      period:
        {
          type: object,
          required: [days_elapsed, days_total],
          properties: { days_elapsed: { type: integer, minimum: 1 }, days_total: { type: integer, minimum: 1 } },
        }
output:
  schema:
    type: object
    required: [campaigns, total_spend_cents]
    properties:
      campaigns: { type: array, items: { type: object } }
      total_spend_cents: { type: integer }
---

.period as $p
| .rows
| group_by(.campaign)
| map({ campaign: .[0].campaign,
spend_cents: (map(.cost_cents) | add),
budget_cents: .[0].budget_cents,
projected_cents: ((map(.cost_cents) | add) * $p.days_total / $p.days_elapsed | floor) })
| map(. + { pace_permille: (if .budget_cents == 0 then null else (.projected_cents * 1000 / .budget_cents | floor) end) })
| { campaigns: ., total_spend_cents: (map(.spend_cents) | add) }
```

The front matter uses Dotprompt's keys where they apply, `description`, `input` and `output`, and one key of its own, `language`, which names the program's language; `jq` is the first and only language in this record. The body is the program. `model`, `config`, `tools` and `output.format` are not keys of a computation function and are refused as unknown, as inference refuses `language`. The input may be any JSON value its schema allows, not only an object. The document's media type is `text/markdown` as a reason function's is.

The reader of such documents, the split of front matter and body, the YAML rules and the schema checks move from the inference primitive to the specs package, where every primitive supplies its own keys and the inference primitive keeps its own; the empty-front-matter message names the keys the primitive requires. The registry, versions and every spec operation need nothing new. Parsing is validation, as for a reason function: a program that does not compile, a schema that is not a JSON Schema, an unknown key or language, a program that names a function or a variable outside the allowed set, each rejected with its line in the body, mapped from the evaluator's span.

### 2. A run applies the program to its input and answers its output, and nothing else

`execute_spec` of a computation function validates the input against `input.schema`, applies the program to the input as the jq value `.`, requires exactly one output, validates it against `output.schema`, measures the output with the run's record against the 1 MiB a run may record, and records the run. The program sees its input and the evaluator's standard library and nothing else: `now` is refused at save along with `env`, `input`, `inputs`, `input_filename`, `input_line_number`, `debug`, `stderr`, `halt`, `halt_error`, `builtins`, `localtime`, `strflocaltime`, and the variables `$ENV` and `$__loc__`, by a refusal list the evaluator takes from its caller and by a check of variable names the evaluator gains. The same input gives the same output on every host running the same image, and a run can be replayed from its record; across image versions the engine's approximations of `pow` and `log` may differ in the last digits, and the record says so.

The run ends:

- `invalid_input` when the input fails its schema, with the pointer, as every run;
- `conflict` with kind `unworkable` when the program raises, produces no output or more than one, exhausts its work, overflows the value depth, or answers a value the output schema refuses or that does not fit the record; the detail carries the program's own error and the body line, so the author corrects the function. The specs package records the kind of a conflict on the run, in its schema, its listing and its words, which it does not today. In a workflow the ending is a `runtime` error, and the format reference says a retry policy should not match it, because the same input gives the same result;
- `unavailable` only when the run's deadline or memory limit stops it, or when no worker is free, which is the server's doing;
- `failed` only when the server itself breaks, which for a worker means any ending other than the primitive's own termination at the deadline or the worker's out-of-memory error, both of which the primitive tells apart from a crash.

The record of a run holds the work spent in units, the duration, and the sizes of input and output; `get_execution_history` shows the run as the presenters of decision 0002 show any run, within 4 KiB.

### 3. Where it runs, and the bounds

A computation run evaluates in a worker thread from a pool the server bounds, four workers by default and a setting, each with the evaluator's deadline inside the work charge and the thread's own memory limit, terminated at the deadline; the program and the input cross to the worker as copies and the output comes back the same way, so the ledger and the run's record are written by the main thread, which never waits on the worker; a run that finds no free worker within its deadline is `unavailable`. Starting a worker and loading the evaluator costs about ten milliseconds. The evaluator runs without its count and step limits, keeping its fixed depth of recursion so that the same program ends the same way on every host, so work governs, with `until`, `while` and `recurse` made iterative in the patch; a value's depth is capped at 512 where values are built, in `fromjson`, in construction and in path updates, because a deep value overflows the stack at a depth that depends on the host and no `try` catches that. The hosted runtime must offer an equivalent way to bound time and memory, which its adapter decides; until then it does not offer computation functions, as decision 0003 says of tools.

| Bound                  | Value                                                                                                                                                                                                                                                                     | When reached                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Input                  | 256 KiB, as every run, nested at most 512 levels                                                                                                                                                                                                                          | `invalid_input`                                |
| Output with the record | 1 MiB, as every run, measured by the primitive, which leaves the output 1,048,320 bytes                                                                                                                                                                                   | `conflict`, `unworkable`                       |
| Work of one run        | 64,000,000 units, four times what one workflow input may do; the example costs 1,939,824 units for 1,000 rows, and its input bound caps it at 3,911 rows, 262,092 bytes, which cost 7,533,024 units, so the work bound is reached by work that grows faster than the data | `conflict`, `unworkable`, with the units spent |
| Value depth            | 512                                                                                                                                                                                                                                                                       | `conflict`, `unworkable`                       |
| Depth of evaluation    | 10,000 levels, which `def g: if . == 0 then 0 else (. - 1 \| g) end` reaches after 1,999 calls                                                                                                                                                                            | `conflict`, `unworkable`                       |
| Nesting of the program | 128 levels                                                                                                                                                                                                                                                                | refused at save, with the line                 |
| Duration               | 10 s from the start of the run, its wait for a worker included; a safeguard, since every charged construct spends 64,000,000 units in at most 414 ms on the machine measured                                                                                              | `unavailable`                                  |
| Memory of the run      | 256 MiB of heap, and a stack of 64 MiB                                                                                                                                                                                                                                    | `unavailable`                                  |
| Workers at once        | 4 by default, `COMPUTATION_WORKERS` from 1 to 64                                                                                                                                                                                                                          | `unavailable`                                  |
| Program length         | 64 KiB, as a spec document                                                                                                                                                                                                                                                | refused at save                                |

Measured on Node 26.10.0 on an Apple M4 Max with 16 cores and 128 GiB, by `pnpm --filter @beonauto/computation measure`: the example over its largest input took 4.0 ms at the median; the 32 charged constructs spent 64,000,000 units in 414 ms at most (updating an object), 354 ms (merging objects), 257 ms (listing entries), 196 ms (the regex machine) and 142 ms or less for every other; a run of a program that answers at once took 27.5 ms at the median, its worker started and ended, against the ten milliseconds estimated above; a worker that never answers was stopped 500.9 ms into a deadline of 500 ms; and the runs that allocate most for their work grew a worker's heap to at most 147.4 MiB of its 256.

Workflow expressions keep their own budgets; the computation reference page carries these bounds, with the machine they were measured on. The evaluator charges a string's length wherever it is used as an object key, in indexing, `has`, construction and path updates, so a program that hashes huge keys ends by its work as a `conflict`, not by the deadline as `unavailable`.

### 4. What the language is, stated plainly

The reference page for computation functions states the dialect: it is the evaluator's jq, with the deviations listed and measured, `unique` and `unique_by` not sorting, `to_entries`, `with_entries` and `tojson` sorting keys, strings comparing by UTF-16 code unit, `tonumber` accepting hexadecimal and blanks, `label` and `break` refused at save by a check of the syntax, since they parse but give wrong answers, a pipe inside a `reduce` or `foreach` update needing parentheses, regular expressions without lookahead or backreferences, `strftime` without `%c`. Numbers are doubles: integers exact to 2^53, no decimal type, no rounding to places, so money is computed in integer minor units, as the example does, and the page says so first.

### 5. In a workflow, a computation function is a call like any other

A workflow calls a computation function through `execute_spec` exactly as it calls a reason function, with the format's retry and timeout rules, and the result flows into the next step. Because it declares that it reaches nothing outside, a workflow may retry it freely and the no-rerun rule of decision 0003 does not apply; a retry of a deterministic failure gives the same result, which is why that failure is a `conflict`. The format's own expressions remain for small transforms inside a workflow; a computation function is for logic that deserves a name, a version, a schema and a test of its own.

### 6. Vocabulary and surfaces

In text a user reads it is a computation function, the name the documentation already gives it; in code and the API it is the `computation` primitive, `primitive: computation` in the spec operations and `/specs/computation` in the routes, as the rule for every primitive. The primitive's description reaches an assistant through the descriptions of the spec tools, as inference's does; the MCP instructions and the tool count do not change. The CI smoke step executes a computation function in the image.

### 7. What this record does not decide

A second language, sandboxed JavaScript or WebAssembly, for logic that needs loops over large data, libraries, decimals or statistics, which would sit behind the same `language` key with its own bounds and its own record; forecasts and elasticities, which stay outside until the predict function exists; a computation function that reads the ledger or recalls, which belongs to the recollection primitive; one computation function calling another; tests or examples inside a document; `input.default`; and a local runner, so an author learns the work a run spends from its record.

## Consequences

- The brain gets its first deterministic function with little new infrastructure: the evaluator, exported from the engine with a refusal list per caller and a check of variable names; the shared document reader in the specs package; a worker per run; the bounds.
- Users save the arithmetic the model must not do as a versioned function with a schema, and workflows call it between a read and the words, which the predecessor could reach only with code; what the predecessor could do and this cannot, exact decimals, large data, libraries and statistics, is named above and waits for the second language.
- The document shape stays one: front matter and a body, with the body's meaning given by the primitive. A second language changes the body, not the shape.
- A computation function's run is replayable from its record and cheap to test: the same input, the same output, on any host of the same image.
- The evaluator's fixes for regular expressions and time, needed here, also close two holes in the server today, where workflow expressions run in-process.

## Verification the build must include

- Parsing: every refusal of section 1 with its body line; the Dotprompt keys that apply and the refusal of `model`, `config`, `tools` and `output.format`; every function and variable of section 2 refused at save by a test over the list; a program that compiles but raises at run time.
- Runs: input validated and refused with a pointer; no output, two outputs, a raise, an output the schema refuses, and an output over the record's room each ending as `conflict` `unworkable` with the program's error and line, the kind recorded on the run and shown in the listing; a 100,000-deep value refused at the depth cap rather than overflowing; the key-hashing program ending as `conflict` by its work; the pool refusing a fifth run as `unavailable` and a worker crash ending as `failed`; determinism, the same output for the same input across two servers and two stores; each bound of the table hit by one test and ending as the table says, the regular-expression and key-hashing programs of the audit among them, stopping within their deadline; the worker terminated at the deadline with the event loop free, proven by a request served meanwhile; the record's fields; the history's presentation within 4 KiB.
- Numbers: the example's cents exact; a test that shows the double behaviour the page documents.
- The workflow: a workflow that reads rows through a fake MCP server, computes with a computation function and reasons with a scripted model, end to end through the real server over HTTP and MCP; a retry of the computation step after a transient failure; a `conflict` not retried.
- The plain words through the internal-terms check; the reference page beside the reasoning format with the dialect and the number rules; the availability row; the CI smoke step's computation run.

## Build

1. `@beonauto/workflow-engine`: the evaluator and the worker pool exported from the `dsl` subpath, the pool shared by every capability that evaluates programs, with a refusal list per caller, a check of variable names and of syntax kinds, errors with spans, exactly-one-output mode, limits that can be lifted, the depth cap where values are built, the key-length charge, iterative `until`, `while` and `recurse` in the patch, on top of the regular-expression and deadline fixes already under way. `@beonauto/specs`: the shared document reader with per-primitive keys, and the kind of a conflict recorded on a run. `primitives/computation` as `@beonauto/computation`: the document, the bounds, the record, the description and words, the presenter decision; wired into the server's primitives and the CI smoke step.
2. The documentation: the reference page with the dialect and the number rules, the availability row, and the workflow example.

## Amendments from the build

What building it showed, and what it changed in the decision above:

- **A fixed depth of evaluation, not a lifted one.** The evaluator runs with its count and step limits lifted, but keeps a depth of evaluation of 10,000 levels, and every worker has a fixed stack of 64 MiB. A recursion without a bound ends where the thread's stack does, which depends on the host: unbounded, the recursion above reached 26,658, 26,703 and 26,711 calls in three measurements of the same worker. With the bound, it ends at the same call on every host, as a `conflict` `unworkable` whose detail says `The program recursed deeper than the 10000 levels of evaluation a run may nest` and gives the line.
- **A bound on the nesting of a program, at save.** The parser of jq and every walk of a program's tree recurse, so whether a program was accepted depended on the stack of the thread that read it: a program of 5,000 terms joined by `+` was refused with a stack overflow on Node's default stack of 984 KB and accepted on one of 4 MB, and parentheses overflowed the parser between 350 and 400 levels. A program, and a workflow expression, may nest 128 levels, where each link of a chain of pipes, operators, definitions or bindings counts one; beyond that it is refused at save with its line, the same way on the main thread and in a worker. A program of more than about 128 pipes in one chain is refused by this bound.
- **`fromjson` charges before it parses.** Node ends the whole process when a worker runs out of heap inside native code, which no limit of the worker catches; `fromjson` of the text of a million empty lists did so at 256 MiB. It now charges 16 units for each character before it parses, so that program ends by its work.
- **One worker for each run.** A worker is started for each run and terminated with it, so no state passes from one run to the next and a terminated worker never has to be replaced; starting one costs 27.5 ms at the median, above the ten milliseconds estimated, because the worker strips the types of its modules as it loads them. The deadline is the request's, counted from the start of the run, so a run that waits for a worker spends its own time waiting.
- **No kind for `unavailable`.** A computation function's `unavailable` endings carry a detail that says which bound stopped the run, or that no worker was free, and no kind.
- **The plain words name it.** The definition label and `BrainFunctionDefinition` of the specs package include computation, so the words, the listings and the history call it a computation function, and its runs are function runs.
- **The memory bound is tested with a small heap.** The test that reaches the memory bound runs a worker of 16 MiB on a program whose allocation the evaluator interrupts, since a program that runs out of heap inside native code ends the process that tests it.
- **The hosted runtime.** It does not offer computation functions until its adapter bounds the time and the memory of a run; the public documentation says Auto Cloud does not offer them yet.
