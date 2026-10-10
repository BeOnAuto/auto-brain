<div v-pre>

# Computation function format

The API stores a computation function as a definition of the type `computation`. Its source document declares the input and output contracts and holds a program, written in TypeScript, that computes the output from the input. A run calls the program's function with its input and answers with the value it returns, the same output for the same input every time. Use one for the arithmetic and data shaping a language model should not do: totals, paces, projections and transformations of rows of figures.

Numbers are double-precision floating point. Integers are exact up to 2^53, there is no decimal type and nothing rounds to decimal places, so compute money in whole minor units, such as cents, as the example below does. See [Numbers](#numbers).

## A function document

The source is Markdown with YAML front matter followed by the program. This example turns rows of campaign costs into spend, projection and pace per campaign, in cents:

<!-- prettier-ignore -->
```markdown
---
description: Spend, pace and projection per campaign, in cents, for a reporting period
language: typescript
input:
  schema:
    type: object
    required: [rows, period]
    properties:
      rows: { type: array, items: { type: object, required: [campaign, cost_cents, budget_cents], properties: { campaign: { type: string }, cost_cents: { type: integer }, budget_cents: { type: integer } } } }
      period: { type: object, required: [days_elapsed, days_total], properties: { days_elapsed: { type: integer, minimum: 1 }, days_total: { type: integer, minimum: 1 } } }
output:
  schema:
    type: object
    required: [campaigns, total_spend_cents]
    properties:
      campaigns: { type: array, items: { type: object } }
      total_spend_cents: { type: integer }
---
export default function (input: Input): Output {
  const { days_elapsed, days_total } = input.period;
  const campaigns = [...Map.groupBy(input.rows, (row) => row.campaign)]
    .toSorted(([first], [second]) => (first < second ? -1 : 1))
    .map(([campaign, rows]) => {
      const spend_cents = rows.reduce((sum, row) => sum + row.cost_cents, 0);
      const budget_cents = rows[0].budget_cents;
      const projected_cents = Math.floor((spend_cents * days_total) / days_elapsed);
      const pace_permille = budget_cents === 0 ? null : Math.floor((projected_cents * 1000) / budget_cents);
      return { campaign, spend_cents, budget_cents, projected_cents, pace_permille };
    });
  return { campaigns, total_spend_cents: campaigns.reduce((sum, each) => sum + each.spend_cents, 0) };
}
```

`Input` and `Output` are the input and output schemas as TypeScript types, which the runtime declares for the program; see [Types](#types). For this document, `create_definition` takes `type: "computation"`, a function `name` such as `campaign-pace`, and the document as `source`. `run_definition` takes the same type and name, with `rows` and `period` in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain.

Given this input:

```json
{
  "rows": [
    { "campaign": "spring-sale", "cost_cents": 125000, "budget_cents": 800000 },
    { "campaign": "spring-sale", "cost_cents": 98050, "budget_cents": 800000 },
    { "campaign": "summer-launch", "cost_cents": 40000, "budget_cents": 300000 }
  ],
  "period": { "days_elapsed": 12, "days_total": 31 }
}
```

the run succeeds with this output, and its record shows that it spent 0 checkpoints of work:

```json
{
  "campaigns": [
    {
      "campaign": "spring-sale",
      "spend_cents": 223050,
      "budget_cents": 800000,
      "projected_cents": 576212,
      "pace_permille": 720
    },
    {
      "campaign": "summer-launch",
      "spend_cents": 40000,
      "budget_cents": 300000,
      "projected_cents": 103333,
      "pace_permille": 344
    }
  ],
  "total_spend_cents": 263050
}
```

## Fields

| Field           | Purpose                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                     |
| `language`      | Required; `typescript`, the brain's one language                                                |
| `input.schema`  | Optional JSON Schema of the input; the input may be any JSON value it allows                    |
| `output.schema` | Optional JSON Schema of the output; an output that does not match it ends the run as a conflict |

Unknown fields are rejected, among them the fields of a reasoning function that do not apply here: `model`, `config`, `tools`, `output.format` and `input.default`. The body after the front matter is the program, and a document without one is rejected. The saved function has the `media_type` `text/markdown`, and its `description`, `input_schema` and `output_schema` come from the document.

## The program

The program is one TypeScript module whose default export is a function `(input: Input): Output`. It may declare types of its own and exported functions, and nothing else at the top level, so that two runs share nothing: a helper is written inside the function that uses it, or exported. It reads its input as its argument and answers with the value it returns. It sees nothing else: no network, no files, no environment, no randomness and no time zone, and the clock it reads is the moment the run started.

### Types

The schemas the document carries are the types the program is checked against. `Input` is `input.schema` and `Output` is `output.schema`, as TypeScript types; a document without one gets `Json`, any JSON value. An object schema with `properties` is a closed type of those properties, the `required` ones required, unless `additionalProperties` opens it; one without `properties` is an object of any JSON values; `enum` and `const` are unions of their values, `anyOf` and `oneOf` unions of their types, and an array keeps its `items` as the type of its elements, however many `maxItems` allows. What a type cannot say, `format`, `pattern`, `minimum`, `maximum` and `multipleOf`, is checked when the run checks its input and output, as before.

### Checked when it is saved

The document is checked when it is saved, with the TypeScript compiler, in the strict mode with `exactOptionalPropertyTypes`, against `Input`, `Output` and the sandbox's own library, so a name the sandbox lacks is a name the compiler lacks. Each problem is refused with its line and the compiler's words:

| Written                                                                                                                                           | Refused with                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A syntax error                                                                                                                                    | The compiler's diagnostic at its line                                                                                                                                              |
| A type error against `Input` or `Output`                                                                                                          | The compiler's diagnostic, such as `Property 'perod' does not exist on type 'Input'. Did you mean 'period'?`                                                                       |
| An `enum`, a `namespace`, a parameter property or a decorator                                                                                     | `This syntax is not allowed when 'erasableSyntaxOnly' is enabled`                                                                                                                  |
| An `import`, `require`, `eval`, `new Function`, `import()`, `import.meta` or a declared name such as `declare global`                             | `A program reads nothing but its arguments: it imports no module and builds no code`                                                                                               |
| A top-level statement other than a type or an exported function, such as `let`, a class or a function the module does not export                  | `A module holds its types and its exported functions and nothing else, so that two calls share nothing`                                                                            |
| No default export, or one whose type is not `(input: Input) => Output`                                                                            | `The program is a module whose default export is a function (input: Input): Output`, and the compiler's words                                                                      |
| `async`, `await` or a generator exported                                                                                                          | `The program is a function that answers at once; it awaits nothing`                                                                                                                |
| More than 500 assignments to variables in one function, `+=`, `++` and the like among them, at the 501st                                          | `A function may assign to its variables at most 500 times, since the compiler's analysis of each assignment grows with the others; keep the values in a list, an object or a loop` |
| A name the sandbox lacks: `fetch`, `setTimeout`, `console`, `process`, `Intl`, `Math.random`, `WeakRef`, `Promise`, a local-time method of `Date` | The compiler's `Cannot find name` or `Property does not exist`                                                                                                                     |
| `language` other than `typescript`                                                                                                                | `The brain's one language is TypeScript; write the program as a TypeScript function`                                                                                               |

A program that is checked can still raise an error when it runs, such as `throw new Error("no rows")` or reading a field of `null`; see [How a run ends](#how-a-run-ends). The check runs on a worker of its own beside the runs, and a check that does not answer within 2 seconds leaves the document unsaved, `unavailable`; save it again.

### The sandbox

The program runs in QuickJS compiled to WebAssembly, the build `@jitl/quickjs-wasmfile-release-sync` 0.32.0, which the runtime pins: the work a program costs is counted by that build, so a new build is a change this page notes. The library is the language's own, ES2023 and more, such as `Array.prototype.toSorted`, `Map.groupBy`, `Object.groupBy`, `Set.prototype.union`, the iterator helpers and `BigInt`. What would read the host is gone or fixed:

- `Date.now()` and `new Date()` answer the moment the run started. `new Date(number)`, `new Date(date)`, a date alone such as `new Date("2026-01-01")` and a date and time that names its offset such as `new Date("2026-01-01T09:00:00Z")` work; `new Date(2026, 0, 1)`, a date and time without its offset and calling `Date` without `new` raise a `TypeError`, since they read the server's time zone, and so do `String(date)`, a template literal of one and `toLocaleString()`. Use `Date.UTC(...)`, the `getUTC…` and `setUTC…` methods and `toISOString()`.
- `Math.random`, `eval`, `Function`, `WeakRef`, `FinalizationRegistry`, `Promise` and every local-time method of `Date` are absent; so are `console`, `fetch`, timers, `Intl` and modules. A program answers at once, so a `Promise`, whose callbacks the sandbox never runs, would only let it do nothing without a word; the check refuses one at save.
- Strings compare and sort by UTF-16 code unit: `sort()` without a comparator sorts by code unit, and `localeCompare` reads no locale.
- The output keeps the order its keys were written in. A program that wants sorted keys sorts them.

The output is the returned value as JSON. A `Date`, a `Map`, a `Set`, a class instance, a boxed number, text or boolean, a typed array, a function, a `BigInt`, a symbol, `NaN`, `Infinity`, `undefined`, an empty place in an array and a cycle cannot be one, and the run ends as a [conflict](#how-a-run-ends) naming where it found the first, such as `The answer holds a Date at $.campaigns[0].at, which JSON cannot carry`.

### Numbers

Every number is an IEEE 754 double:

- Integers are exact up to 2^53, 9,007,199,254,740,992: `9007199254740992 + 1` is `9007199254740992`.
- Decimal fractions are approximations: `0.1 + 0.2 + 0.3` is `0.6000000000000001`, and `Math.round(1.005 * 100)` is `100`.
- There is no decimal type and no rounding to decimal places. Keep amounts in whole minor units, such as cents, multiply before you divide, and end a division with `Math.floor`, `Math.ceil` or `Math.round`, as the example's `projected_cents` and `pace_permille` do.
- `NaN` and `Infinity` are not JSON values, so a run whose output holds one ends as a [conflict](#how-a-run-ends). `BigInt` computes exactly but cannot be an output; turn it into a number or a string first.
- The functions that approximate, such as `Math.pow` and `Math.log`, give the same answer on every run of a runtime's build, and may differ in the last digits between builds.

## How a run ends

A run first checks the input against `input.schema`, then calls the program, checks its answer is JSON and checks it against `output.schema`. It ends in one of these ways:

| Ending                        | When                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                   | The program returned a value that is JSON and matches the output schema                                                                                                                                                                                         |
| `invalid_input`               | The input does not match the input schema, with a pointer to each problem, or nests deeper than 512 levels                                                                                                                                                      |
| `conflict`, kind `unworkable` | The program raised an error, a stack overflow among them, did more work or used more memory than a run may, returned what JSON cannot carry or a value deeper than 512 levels, or returned what the output schema refuses or what does not fit the run's record |
| `unavailable`                 | The run took longer than a run may, or found no turn to run within its time                                                                                                                                                                                     |
| `failed`                      | The runtime itself broke down                                                                                                                                                                                                                                   |

A `conflict` of the kind `unworkable` names the program's own error and the line of the document it came from, such as `The program raised an error on line 21: Error: no rows`, or the bound it reached, such as `The program did more work than a run may, 20000 checkpoints, and was stopped`. The text of the program's error is cut at 1,024 bytes of UTF-8 and marked with `…`, and so are the pointer and the detail of each issue of an output the schema refuses, each on its own. The same input gives the same result every time, so running it again does not help: update the definition, or change the input. `get_run` shows the kind on the run's rejection, and `list_runs` shows it in the listing.

A run that succeeds records `language`, `work`, the checkpoints it spent, `duration_ms`, and `input_bytes` and `output_bytes`, the sizes of its input and output as JSON. `get_run` returns that record with the output.

## Bounds

| Bound              | Value                                                                                                                                                                | When it is reached                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Document           | 65,536 bytes in UTF-8, as every definition                                                                                                                           | Refused when saved                                          |
| The check at save  | 2 seconds on the check's own worker, counted once it is ready; the server starts it when it starts and keeps it                                                      | The save is `unavailable`; save it again                    |
| Assignments        | 500 to variables in one function, counted before the compiler analyses them, since its analysis grows with their square: 500 cost it 43 ms, 1,000 cost 249 ms        | Refused when saved, `invalid_input`                         |
| Input              | 256 KiB as JSON, as every run, nested at most 512 levels                                                                                                             | `invalid_input`                                             |
| Work               | 20,000 checkpoints: the engine counts one every 10,000 of its steps, a call or the jump of a loop each, about 0.024 ms of a tight loop on the machine measured below | `conflict`, `unworkable`                                    |
| Memory             | 256 MiB, the maximum of the run's sandbox on a self-hosted runtime; another host may set another                                                                     | `conflict`, `unworkable`                                    |
| Stack              | 1 MiB, which a function that calls itself reaches after 5,459 calls; the overflow is an error the program may catch, at the same depth every time                    | `conflict`, `unworkable` when the program does not catch it |
| Depth of a value   | 512 levels, in the input and in the output                                                                                                                           | `invalid_input`; `conflict`, `unworkable`                   |
| Regular expression | Bounded by the work and the duration: the engine interrupts a pattern that backtracks                                                                                | As work                                                     |
| Output             | 1 MiB as JSON together with the run's record, as every run, which leaves the output 1,048,320 bytes                                                                  | `conflict`, `unworkable`                                    |
| Text of an error   | 1,024 bytes of the program's error, and of the pointer and of the detail of each issue of an output the schema refuses, then `…`                                     | Cut, in the `conflict`                                      |
| Duration           | 10 seconds from the start of the run, its wait for a turn included                                                                                                   | `unavailable`                                               |
| Runs at once       | 4 by default, which the operator of a self-hosted runtime can change, and one check at a time beside them; a run waits for its turn within its 10 seconds            | `unavailable`                                               |

Work is counted in checkpoints of the engine, so it does not depend on the machine, and the same program and input spend the same checkpoints on every run and every host of the same build. The example above spends no checkpoint on 1,000, 2,000, 3,911 or 4,000 rows, the largest input a run takes holding 3,911 such rows, 262,092 bytes, so the bound on work stops a program whose work grows faster than its data, never the example. A checkpoint counts the engine's steps and not its native work, such as one `JSON.stringify` of a large value, which is why the duration stands beside it.

Measured on Node 26.10.0 on an Apple M4 Max, the example over 3,911 rows took 4.7 ms in a fresh sandbox, one checkpoint of a loop that does nothing 0.042 ms, so the 20,000 checkpoints of a run take from under a second to about eleven seconds of interpretation, depending on what each step does, and a run took about a millisecond more than its program, with or without an output schema, in a worker the server keeps ready between runs; the first run of a worker, and the first after a minute without runs, still pays its start, about 200 ms. A loop whose body is one native operation over a large value, such as `JSON.stringify` or `join`, spends few checkpoints, and a run of one ends at its 10 seconds. A run that never answered was stopped 0.6 ms after a deadline of 500 ms.

## In a workflow

A workflow calls a computation function as it calls a reasoning function, with `call: run_definition` and `type: computation`, and the task's output is the function's output; see [Calling a function](workflow-format.md#calling-a-function). The function reaches nothing outside the brain, so a workflow may run it again freely: its result does not depend on how often it ran.

A run rejected with `conflict` raises a `runtime` error with status 409, and the error's `kind` is `unworkable`, whether the program raised, did too much work or used too much memory. A retry gives the same result for the same input, so a retry policy should not match it: retry on status 503, which a run that was `unavailable` raises, as the example below does.

This workflow reads a month's campaign costs through an MCP server, computes the pace of each campaign and has a reasoning function write a summary. A workflow reaches an MCP server only through a reasoning function's [tools](reasoning-format.md#tools), so the first function reads the rows and passes them on unchanged; the arithmetic happens in the computation function, and the words in the last reasoning function.

The reasoning function `read-campaign-costs`:

```markdown
---
description: Reads the cost rows of every campaign for a month
model: anthropic/claude-sonnet-4-5
tools: [ads/campaign-costs]
input:
  schema:
    type: object
    properties:
      month: { type: string }
    required: [month]
output:
  format: json
  schema:
    type: object
    properties:
      rows:
        type: array
        items:
          type: object
          properties:
            campaign: { type: string }
            cost_cents: { type: integer }
            budget_cents: { type: integer }
          required: [campaign, cost_cents, budget_cents]
    required: [rows]
---

Call ads/campaign-costs for the month {{ input.month }} and answer with the rows it gives, exactly as it gives them. Do not add, round or calculate anything.
```

The computation function `campaign-pace` is the document at the top of this page. The reasoning function `write-pace-summary`:

```markdown
---
description: Summarizes the pace of each campaign for its owners
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      campaigns: { type: array }
      total_spend_cents: { type: integer }
    required: [campaigns, total_spend_cents]
---

Write three sentences for the campaign owners about this month so far. A pace of 1000 per mille means a campaign is on course to spend exactly its budget. Use the figures as given; they are in cents.
Campaigns: {{ input.campaigns | json }}
Total spend in cents: {{ input.total_spend_cents }}
```

The workflow `campaign-pace-report`:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-reporting
  name: campaign-pace-report
  version: '1.0.0'
  summary: Reads a month's campaign costs, computes each campaign's pace and writes a summary.
input:
  schema:
    document:
      type: object
      properties:
        month: { type: string }
        period: { type: object }
      required: [month, period]
do:
  - read:
      call: run_definition
      with:
        type: reasoning
        name: read-campaign-costs
        input: { month: '${ $data.month }' }
      output:
        as: '${ ({ rows: $data.rows, period: $input.period }) }'
  - compute:
      try:
        - pace:
            call: run_definition
            with:
              type: computation
              name: campaign-pace
              input: '${ $data }'
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: { seconds: 2 }
          limit:
            attempt: { count: 2 }
  - write:
      call: run_definition
      with:
        type: reasoning
        name: write-pace-summary
        input:
          campaigns: '${ $data.campaigns }'
          total_spend_cents: '${ $data.total_spend_cents }'
```

`run_definition` of `campaign-pace-report` takes an input such as `{"month": "2026-09", "period": {"days_elapsed": 12, "days_total": 30}}`. The run reads the rows, computes them, and ends with the summary as its output. When the computation function's run is `unavailable`, the `compute` task tries it up to twice more; when the program raises an error or reaches a bound of its sandbox, the run ends `rejected` at once, and the history shows the computation function's run with its line and error.

## Availability

Computation functions are available in a self-hosted runtime; Auto Cloud does not offer them yet. See [Functions and availability](../concepts/functions.md#availability).

</div>
