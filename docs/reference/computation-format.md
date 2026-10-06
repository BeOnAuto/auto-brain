<div v-pre>

# Computation function format

The API stores a computation function as a `computation` spec. Its source document declares the input and output contracts and holds a program, written in jq, that computes the output from the input. A run applies the program to its input and answers with exactly one output, the same output for the same input every time. Use one for the arithmetic and data shaping a language model should not do: totals, paces, projections and transformations of rows of figures.

Numbers are double-precision floating point. Integers are exact up to 2^53, there is no decimal type and nothing rounds to decimal places, so compute money in whole minor units, such as cents, as the example below does. See [Numbers](#numbers).

## A function document

The source is Markdown with YAML front matter followed by the program. This example turns rows of campaign costs into spend, projection and pace per campaign, in cents:

<!-- prettier-ignore -->
```markdown
---
description: Spend, pace and projection per campaign, in cents, for a reporting period
language: jq
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

For this document, `create_spec` takes `primitive: "computation"`, a function `name` such as `campaign-pace`, and the document as `source`. `execute_spec` takes the same primitive and name, with `rows` and `period` in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain.

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

the run succeeds with this output, and its record shows that it spent 19,756 units of work:

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
| `language`      | Required; `jq`, the one language a computation function is written in today                     |
| `input.schema`  | Optional JSON Schema of the input; the input may be any JSON value it allows                    |
| `output.schema` | Optional JSON Schema of the output; an output that does not match it ends the run as a conflict |

Unknown fields are rejected, among them the fields of a reasoning function that do not apply here: `model`, `config`, `tools`, `output.format` and `input.default`. The body after the front matter is the program, and a document without one is rejected. The saved function has the `media_type` `text/markdown`, and its `description`, `input_schema` and `output_schema` come from the document.

## The program

The program reads its input as `.` and answers with the value it outputs. It sees nothing else: no clock, no environment, no files and no network. These are rejected when the document is saved, each with the reason and the line:

| Rejected                                                                                                     | Why                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `now`                                                                                                        | It reads the clock; pass the time in the input                                       |
| `env`, `$ENV`, `input`, `inputs`, `input_filename`, `input_line_number`, `$__loc__`, `builtins`              | They read something other than the input                                             |
| `localtime`, `strflocaltime`                                                                                 | They read the host's time zone; use the UTC builtins such as `todate`                |
| `debug`, `stderr`, `halt`, `halt_error`                                                                      | They write outside the program; a computation function answers only with its output  |
| `label`, `break`                                                                                             | They give wrong answers in this dialect; use `reduce`, `foreach`, `limit` or `first` |
| A `$variable` the program does not bind with `as`, `reduce` or `foreach`                                     | Nothing outside the program defines one                                              |
| A program that does not parse, or names a function that does not exist or with the wrong number of arguments | The program must be valid                                                            |
| A program that nests more than 128 levels deep                                                               | See [Bounds](#bounds)                                                                |

A program that is valid can still raise an error when it runs, such as `error("no rows")` or a division by zero; see [How a run ends](#how-a-run-ends).

### Numbers

Every number is an IEEE 754 double:

- Integers are exact up to 2^53, 9,007,199,254,740,992: `9007199254740992 + 1` is `9007199254740992`.
- Decimal fractions are approximations: `[0.1, 0.2, 0.3] | add` is `0.6000000000000001`, and `1.005 * 100 | round` is `100`.
- There is no decimal type and no rounding to decimal places. Keep amounts in whole minor units, such as cents, multiply before you divide, and end a division with `floor`, `ceil` or `round`, as the example's `projected_cents` and `pace_permille` do.
- `nan` and `infinite` are not JSON values, so a run whose output holds one ends as a [conflict](#how-a-run-ends). Number literals beyond the range of a double, such as `1e1000`, are rejected when the document is saved.
- Numbers are written in their shortest form: `1.0 | tojson` is `"1"`.
- The functions that approximate, such as `pow` and `log`, give the same answer on every run of a runtime version, and may differ in the last digits between versions.

### How the dialect differs from jq

The language is the dialect of jq that [workflow expressions](workflow-format.md#expressions) use. It differs from jq 1.7 in these places:

- `unique` and `unique_by` keep the order in which values first appear, rather than sorting: `[3, 1, 2, 1] | unique` is `[3, 1, 2]`. Write `sort | unique` for jq's result.
- `to_entries`, `with_entries` and `tojson` sort the keys of an object.
- Strings compare and sort by UTF-16 code unit.
- `tonumber` accepts hexadecimal and surrounding blanks: `"0x1F" | tonumber` is `31`, and `" 12 " | tonumber` is `12`.
- `ltrimstr` and `rtrimstr` raise an error on a value that is not a string, where jq answers it unchanged.
- `error` with a value that is not a string is caught by `try ... catch` as that value's JSON text.
- A pipe inside the update of a `reduce` or `foreach` needs parentheses: write `reduce .[] as $x (0; (. + $x | . * 2))`.
- Function parameters are filters, never `$variables`: write `def f(a): a;`, not `def f($a): $a;`.
- `getpath` cannot be the target of an update such as `|=`, and the alternative destructuring operator `?//` is not supported.
- Regular expressions have no lookahead or backreferences.
- `strftime` does not support `%c`: `0 | strftime("%c")` gives `"%c"` unchanged.

## How a run ends

A run first checks the input against `input.schema`, then applies the program, requires exactly one output and checks it against `output.schema`. It ends in one of these ways:

| Ending                        | When                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                   | The program gave one output that matches the output schema                                                                                                                                                                                                                       |
| `invalid_input`               | The input does not match the input schema, with a pointer to each problem, or nests deeper than 512 levels                                                                                                                                                                       |
| `conflict`, kind `unworkable` | The program raised an error, gave no output or more than one, did more work, built a deeper value or recursed deeper than a run may, overflowed the stack of its run, gave `nan` or `infinite`, or answered what the output schema refuses or what does not fit the run's record |
| `unavailable`                 | The run took longer or used more memory than a run may, or found no turn to run within its time                                                                                                                                                                                  |
| `failed`                      | The runtime itself broke down                                                                                                                                                                                                                                                    |

A `conflict` of the kind `unworkable` names the program's own error and the line of the document it came from, such as `The program raised an error on line 4: no rows`. The text of the program's error is cut at 1,024 bytes of UTF-8 and marked with `…`, and so are the pointer and the detail of each issue of an output the schema refuses, each on its own, so an issue at a very long key still says what is wrong. A long error is answered, recorded and passed to a workflow at that size. The same input gives the same result every time, so running it again does not help: update the definition, or change the input. `get_execution` shows the kind on the run's rejection, and `list_executions` shows it in the listing.

A run that succeeds records `language`, `work`, the units of work it spent, `duration_ms`, and `input_bytes` and `output_bytes`, the sizes of its input and output as JSON. `get_execution` returns that record with the output.

## Bounds

| Bound                  | Value                                                                                                                                                                    | When it is reached                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Document               | 65,536 bytes in UTF-8, as every definition                                                                                                                               | Refused when saved                                          |
| Nesting of the program | 128 levels: each expression inside another counts one, and so does each link of a chain of pipes, of operators such as `+`, `and` or `//`, of definitions or of bindings | Refused when saved, with the line                           |
| Input                  | 256 KiB as JSON, as every run, nested at most 512 levels                                                                                                                 | `invalid_input`                                             |
| Work                   | 64,000,000 units                                                                                                                                                         | `conflict`, `unworkable`, with the units spent              |
| Depth of a value       | 512 levels, wherever a value is built: by construction, by an update of a path and by `fromjson`                                                                         | `conflict`, `unworkable`                                    |
| Recursion              | 10,000 levels of evaluation, which a function that calls itself once, such as `def g: if . == 0 then 0 else (. - 1 \| g) end`, reaches after 1,999 calls                 | `conflict`, `unworkable`                                    |
| Regular expression     | 4,096 compiled instructions, and groups nested at most 128 deep                                                                                                          | The program raises `regex too large`, which `try` can catch |
| Output                 | 1 MiB as JSON together with the run's record, as every run, which leaves the output 1,048,320 bytes, measured before it is written                                       | `conflict`, `unworkable`                                    |
| Text of an error       | 1,024 bytes of the program's error, and of the pointer and of the detail of each issue of an output the schema refuses, then `…`                                         | Cut, in the `conflict`                                      |
| Duration               | 10 seconds from the start of the run, its wait for a turn included                                                                                                       | `unavailable`                                               |
| Memory                 | 256 MiB                                                                                                                                                                  | `unavailable`                                               |
| Runs at once           | 4 by default, which the operator of a self-hosted runtime can change; a run waits for its turn within its 10 seconds                                                     | `unavailable`                                               |

Work is counted in units of about one character of data handled, so it does not depend on the machine, and the same program and input spend the same units on every run. The example above spends 1,939,824 units on 1,000 rows, 3,857,976 on 2,000 and 7,694,800 on 4,000. The largest input a run takes holds 3,911 such rows, 262,092 bytes, on which the example spends 7,533,024 units, so the bound on work stops a program whose work grows faster than its data, never the example.

The duration is a safeguard for what work does not stop. Measured on Node 26.10.0 on an Apple M4 Max, the example over 3,911 rows took 4.0 ms at the median, every construct the work counts spent the 64,000,000 units of a run in at most 414 ms, and a run took about 28 ms more than its program, to start the program apart from the server and end it. A run that never answered was stopped 0.9 ms after a deadline of 500 ms.

## In a workflow

A workflow calls a computation function as it calls a reasoning function, with `call: execute_spec` and `primitive: computation`, and the task's output is the function's output; see [Calling a function](workflow-format.md#calling-a-function). The function reaches nothing outside the brain, so a workflow may run it again freely: its result does not depend on how often it ran.

A run rejected with `conflict` raises a `runtime` error with status 409, and the error's `kind` is `unworkable`. A retry gives the same result for the same input, so a retry policy should not match it: retry on status 503, which a run that was `unavailable` raises, as the example below does.

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
      call: execute_spec
      with:
        primitive: inference
        name: read-campaign-costs
        input: { month: '${ .month }' }
      output:
        as: '${ { rows: .rows, period: $input.period } }'
  - compute:
      try:
        - pace:
            call: execute_spec
            with:
              primitive: computation
              name: campaign-pace
              input: '${ . }'
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: { seconds: 2 }
          limit:
            attempt: { count: 2 }
  - write:
      call: execute_spec
      with:
        primitive: inference
        name: write-pace-summary
        input:
          campaigns: '${ .campaigns }'
          total_spend_cents: '${ .total_spend_cents }'
```

`execute_spec` of `campaign-pace-report` takes an input such as `{"month": "2026-09", "period": {"days_elapsed": 12, "days_total": 30}}`. The run reads the rows, computes them, and ends with the summary as its output. When the computation function's run is `unavailable`, the `compute` task tries it up to twice more; when the program raises an error, the run ends `rejected` at once, and the history shows the computation function's run with its line and error.

## Availability

Computation functions are available in a self-hosted runtime; Auto Cloud does not offer them yet. See [Functions and availability](../concepts/functions.md#availability).

</div>
