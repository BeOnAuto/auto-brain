<div v-pre>

# Recall function format

The API stores a recall function as a `recollection` spec. Its source document names the events of the brain it folds, the view they fold into and how that view starts, and holds a fold, written in jq, that takes the view and one event and answers the next view. The runtime keeps the view as the brain records events, from the first event of its history on, and a run answers from the view as it stands, applying the function's `answer` to it. Use one so that a brain remembers what it decided before: the reviews of each campaign, the latest verdict per region, the refusals of a quarter.

The view is a function of the brain's events alone. Nothing a run passes in is kept, no run changes it, and the same history folds to the same view on every server and either store.

## A function document

The source is Markdown with YAML front matter followed by the fold. This example keeps the reviews that the reasoning function `review-brief` wrote, for each campaign, and answers the last few reviews of the campaign a run names:

<!-- prettier-ignore -->
```markdown
---
description: The reviews of each campaign, latest last, as the review-brief function wrote them
language: jq
source:
  events:
    - type: execution_succeeded
      subject: inference/review-brief
view:
  initial: {}
  schema:
    type: object
    maxProperties: 50
    additionalProperties: { type: array, maxItems: 20 }
input:
  schema:
    type: object
    required: [campaign]
    properties:
      campaign: { type: string }
      last: { type: integer, minimum: 1, maximum: 50 }
output:
  schema:
    type: array
    items: { type: object, required: [at, verdict], properties: { at: { type: string }, verdict: { type: string } } }
answer: '.[$input.campaign] // [] | .[-($input.last // 5):]'
---
($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign
| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]
| .[$campaign] |= .[-20:]
| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries
```

The fold runs once for every run of `review-brief` that succeeds, whatever the model answered, so it guards against every output it may meet:

- an output that is not an object, such as a text or a list, counts for the campaign `unknown`, and so does a campaign that is not a text, such as a number;
- a verdict that is missing reads `none`, one that is not a text, such as a number, reads as its text, and every verdict is cut at 200 characters;
- an output too large for the brain's event, which then carries its size instead of the output, counts for `unknown` with the verdict `none`;
- the view keeps the last 20 reviews of a campaign and the 50 campaigns reviewed most recently, so it stays well under the 512 KiB a view may take. The keys of `to_entries` come sorted by name, so the fold sorts by the time of each campaign's last review before it keeps the last 50.

A fold that raises an error on an ordinary output stops its view at that event, and so does a view that outgrows its bound or its schema; see [When a view stalls](#when-a-view-stalls). Guard the fold, and bound the view, before you save it.

For this document, `create_spec` takes `primitive: "recollection"`, a function `name` such as `campaign-reviews`, and the document as `source`. `execute_spec` takes the same primitive and name, with the `campaign` and optionally how many reviews to answer, `last`, in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain.

After three runs of `review-brief`, the view is:

```json
{
  "autumn-launch": [
    {
      "at": "2026-09-30T14:02:11.000Z",
      "verdict": "approve",
      "run": "/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71"
    }
  ],
  "spring-sale": [
    {
      "at": "2026-10-01T09:15:42.000Z",
      "verdict": "reject: the budget is not stated",
      "run": "/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72"
    },
    {
      "at": "2026-10-03T16:40:05.000Z",
      "verdict": "approve",
      "run": "/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73"
    }
  ]
}
```

Given this input:

```json
{ "campaign": "spring-sale", "last": 1 }
```

the run succeeds with this output:

```json
[
  {
    "at": "2026-10-03T16:40:05.000Z",
    "verdict": "approve",
    "run": "/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73"
  }
]
```

## Fields

| Field           | Purpose                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                          |
| `language`      | Required; `jq`, the one language a recall function is written in today                                                                               |
| `source.events` | Required; 1 to 8 filters, each naming events the fold takes; see [The events](#the-events)                                                           |
| `view.initial`  | Optional; the view before any event, any JSON value within the bound on a view, `null` when left out                                                 |
| `view.schema`   | Optional JSON Schema the view must match after every fold; `initial` must match it too                                                               |
| `input.schema`  | Optional JSON Schema of a run's input; a run given no input runs with `{}`                                                                           |
| `output.schema` | Optional JSON Schema of a run's output; an output that does not match it ends the run as a conflict                                                  |
| `answer`        | Optional jq expression a run applies to the view, reading the view as `.` and the run's input as `$input`; without it, a run answers the view itself |

Unknown fields are rejected, among them the fields of a reasoning function that do not apply here: `model`, `config`, `tools`, `output.format` and `input.default`. The body after the front matter is the fold, and a document without one is rejected. The saved function has the `media_type` `text/markdown`, and its `description`, `input_schema` and `output_schema` come from the document.

## The events

A recall function folds the events of its own brain, in the order the brain recorded them, from the first:

| Events                                                                               | `source`                    | `subject`            | `data`                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_started`, `execution_succeeded`, `execution_rejected`, `execution_failed` | `/executions/<run id>`      | `<primitive>/<name>` | `primitive`, `name`, `version` and `caller`; on a success also `output`, or `output_bytes`, its size, when the output would make the event larger than 240 KiB |
| `spec_created`, `spec_updated`, `spec_retired`                                       | `/specs/<primitive>/<name>` | none                 | `primitive`, `name`, `caller`, and `version` unless retired                                                                                                    |
| An event published to the brain, of any other type                                   | as its publisher gave it    | as given             | as given; see [Publishing events](http.md#publishing-events)                                                                                                   |

Each event is a CloudEvent with its `id`, `type`, `source`, `time`, the time it happened as the brain recorded it, and its `data`; an event the brain recorded as the effect of another names that one in `causationid`, and the run at the top of its chain in `correlationid`. A recall function never folds the events of its own runs. An event the runtime cannot read, such as one whose data nests deeper than 512 levels, is passed over and reported to the operator once.

A filter names the events it takes:

| Key       | What an event must have                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`    | Required; exactly this type, written out                                                                                                                                           |
| `source`  | Optional; exactly this source, written out                                                                                                                                         |
| `subject` | Optional; exactly this subject, written out, such as `inference/review-brief` for the runs of one reasoning function                                                               |
| `data`    | Optional; data equal to this value, or, as an expression such as `'${ .revenue > 100 }'`, data for which it is true; the expression reads the event's data as `.` and nothing else |

An event is folded when it matches any of the filters, and once only. Any other key is rejected, and so are a computed `type`, `source` or `subject` and a `data` expression that names a variable.

## The fold and the answer

The fold reads the view as `.` and the event as `$event`, and answers the next view with exactly one output. The answer reads the view as `.` and the run's input as `$input`, and answers the run's output with exactly one output. Neither sees anything else: no clock, no environment, no files, no network, and no other events. These are rejected when the document is saved, each with the reason and the line:

| Rejected                                                                                                                          | Why                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `now`                                                                                                                             | It reads the clock; read the time of an event as `$event.time`                        |
| `env`, `$ENV`, `input`, `inputs`, `input_filename`, `input_line_number`, `$__loc__`, `builtins`                                   | They read something other than the view and its event or input                        |
| `$ARGS`                                                                                                                           | A recall function is given no arguments; the fold reads `$event`, the answer `$input` |
| `localtime`, `strflocaltime`                                                                                                      | They read the host's time zone; use the UTC builtins such as `todate`                 |
| `debug`, `stderr`, `halt`, `halt_error`                                                                                           | They write outside the program                                                        |
| `label`, `break`                                                                                                                  | They give wrong answers in this dialect; use `reduce`, `foreach`, `limit` or `first`  |
| `$input` in the fold, `$event` in the answer, any variable in a filter, or a `$variable` not bound by `as`, `reduce` or `foreach` | Nothing defines it there                                                              |
| A program that does not parse, or names a function that does not exist or with the wrong number of arguments                      | The program must be valid                                                             |
| A program that nests more than 128 levels deep                                                                                    | See [Bounds](#bounds)                                                                 |

The language is the dialect of jq that computation functions use, with the same numbers: see [Numbers](computation-format.md#numbers) and [How the dialect differs from jq](computation-format.md#how-the-dialect-differs-from-jq). Recursion stops at the same fixed depth, 10,000 levels of evaluation, so a fold stops at the same event on every server.

## How the view is kept

The server that runs the brain's workflows keeps the views. It is woken by every event the brain records through it, so a view follows its brain by the time it takes to fold a page, and by up to a pass, a second, for an event another server recorded. It reads the brain's history in pages of up to 1,000 records and folds each page in a worker apart from the server, and writes each view once a page, so a restart folds at most one page again, to the same view.

Saving a recall function, or a new version of one, builds its view from the start of the brain's history. Until the view has caught up, a run answers `unavailable` with the kind `rebuilding`, which says how many events the view has folded and how far it is behind, and carries `Retry-After`; the previous version does not answer meanwhile, since a run records the latest version. A brain builds at most four views at once, a setting of the runtime; the others wait in the order they were saved, and their runs say so. A newer version replaces an older one that is being built, waiting or stalled.

A run never waits for the view: it answers from what the brain has folded so far. Its record says where that is, so a caller who recorded an event a moment ago and does not see it can tell why:

| Record field         | What it says                                                                   |
| -------------------- | ------------------------------------------------------------------------------ |
| `view.version`       | The version of the recall function the view is of                              |
| `view.checkpoint`    | Where in the brain's history the view has read to, an opaque cursor            |
| `view.checkpoint_at` | When the brain recorded the last record the view read                          |
| `view.last_event`    | The `id` and `time` of the last event the view folded, `null` before the first |
| `view.folded`        | How many events the view has folded                                            |

The record also holds `language`, `work`, the units of work the answer spent, `duration_ms`, and `input_bytes` and `output_bytes`. `get_execution` returns it with the output.

`get_spec` of a recall function adds its view's `standing`:

| Field                                                 | What it says                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                                               | `live` once caught up, `rebuilding` while it is built, `waiting` for its turn to be built, or `stalled`                                     |
| `version`                                             | The version the view is of                                                                                                                  |
| `checkpoint`, `checkpoint_at`, `last_event`, `folded` | As in a run's record                                                                                                                        |
| `lag_ms`                                              | How far the view is behind: the time of the brain's newest record less `checkpoint_at`, to the second on SQLite                             |
| `newest_record_at`                                    | When the brain last recorded anything                                                                                                       |
| `stalled`                                             | For a stalled view, the `event` it stopped at, with its `id`, `type` and `time`, the `kind` of stall, the fold's own `error` and its `line` |

## When a view stalls

A fold that raises an error, gives no output or more than one, does more than its work, nests deeper than a value may, answers a view larger than 512 KiB or one its schema refuses, or gives `nan` or `infinite`, stops its view at that event. The view keeps what it folded before, its other events wait, and the brain's other views go on. A fold that runs longer than 10 seconds is tried again on later passes, since its time depends on the machine, without holding back the brain's other views, and stalls once it has run out of time twenty times. Each fold has its own 10 seconds, so the folds of the brain's other views on the same event never count against it, and the view keeps what it folded before that event. A filter's `data` runs under bounds of its own as large as the fold's, 16,000,000 units of work among them, and shares the fold's 10 seconds: one that does more than its work or nests too deep stalls the view, and one that runs out of time is tried again as a slow fold is.

While its view is stalled, a run answers `conflict` with the kind `stalled`, naming in fixed words the type and time of the event and what went wrong, with the line of the fold, never the fold's own message or the event's values, which the standing shows. The history is the source of the view, so the repair is a corrected version: saving it builds the view again from the start.

## How a run ends

A run first checks the input against `input.schema`, then reads the view, applies `answer`, requires exactly one output and checks it against `output.schema`. It ends in one of these ways:

| Ending                           | When                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                      | The answer gave one output that matches the output schema                                                                                                                                                                                      |
| `invalid_input`                  | The input does not match the input schema, with a pointer to each problem, or nests deeper than 512 levels                                                                                                                                     |
| `unavailable`, kind `rebuilding` | The view of the latest version is not built yet, or waits to be built; try again later                                                                                                                                                         |
| `conflict`, kind `stalled`       | The view stopped at an event its fold could not take; save a corrected version                                                                                                                                                                 |
| `conflict`, kind `unworkable`    | The answer raised an error, gave no output or more than one, did more work, built a deeper value or recursed deeper than a run may, gave `nan` or `infinite`, or answered what the output schema refuses or what does not fit the run's record |
| `unavailable`                    | The answer took longer or used more memory than a run may, or found no turn to run within its time                                                                                                                                             |
| `failed`                         | The runtime itself broke down                                                                                                                                                                                                                  |

A `conflict` of the kind `unworkable` names the answer's own error and its line in the document, such as `The answer raised an error on line 25: no such campaign`. The same view and input give the same result, so running it again does not help.

## Bounds

| Bound                          | Value                                                                                                                                        | When it is reached                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Document                       | 65,536 bytes in UTF-8, as every definition                                                                                                   | Refused when saved                                       |
| Filters                        | 8                                                                                                                                            | Refused when saved                                       |
| Nesting of the fold or answer  | 128 levels                                                                                                                                   | Refused when saved, with the line                        |
| Events a view folds            | The brain's whole history, in the order it was recorded, selected by the filters                                                             | —                                                        |
| Work of one fold               | 16,000,000 units, what one workflow input may do                                                                                             | The view stalls at that event                            |
| Duration of one fold           | 10 seconds; the one stall that depends on the machine's speed                                                                                | Tried again on twenty passes, then the view stalls       |
| View                           | 512 KiB as JSON, checked after every fold, so that a view answered whole fits a run's record                                                 | The view stalls at that event                            |
| Depth of a value               | 512 levels; recursion 10,000 levels of evaluation, as for a computation function                                                             | The view stalls; for an answer, `conflict`, `unworkable` |
| Work of one answer             | 16,000,000 units                                                                                                                             | `conflict`, `unworkable`                                 |
| Output                         | 1 MiB as JSON together with the run's record, as every run, which leaves the output 1,046,528 bytes                                          | `conflict`, `unworkable`                                 |
| Duration and memory of a run   | 10 seconds and 256 MiB, as for a computation function                                                                                        | `unavailable`                                            |
| Recall functions a brain keeps | 32, which the operator of a self-hosted runtime can change; lowering it below what a brain keeps refuses saves and nothing else              | Refused when saved, `conflict`                           |
| Views built at once            | 4 a brain, a setting; a stalled view counts for none                                                                                         | The save succeeds; the standing says `waiting`           |
| Folding time of a page         | 2 seconds from its first fold, checked before each fold, after which the page ends before its next fold and the rest waits for the next page | —                                                        |
| Pages a pass                   | 10 a brain                                                                                                                                   | The brain goes on at the next pass                       |
| Brains followed at once        | 4, a setting                                                                                                                                 | The others wait for their turn                           |
| Lag                            | Reported in the standing and the record, never bounded                                                                                       | —                                                        |

Work is counted as for a computation function, so the same fold spends the same units on every server. The example spent 6,155,033 units on a page of 100 runs of 100 campaigns, about 61,550 an event, well under the bound. Building a view of 100,000 matching events with the example's fold, over runs of 100 campaigns, took 103.5 seconds on SQLite and 111.1 seconds on PostgreSQL in pages of up to 1,000 records, against 183.7 and 195.4 seconds in pages of up to 100, measured one after the other on Node 26.10.0 on an Apple M4 Max under a load average of 90 to 165 on its 16 cores, so an idle machine is faster. Each page runs in a worker started for it, which took between 40 and 280 milliseconds when measured alone, a small part of a page of 1,000 events.

## In a workflow

A workflow calls a recall function as it calls any function, with `call: execute_spec` and `primitive: recollection`, and the task's output is the run's output, typically passed to a reasoning function whose prompt reads it as any input; see [Calling a function](workflow-format.md#calling-a-function). A recall function reaches nothing outside the brain, so a workflow may run it again freely.

A view follows its brain by up to a pass and a page's folds, so a workflow that recalls what it recorded a moment before may not see it yet, and a step sees only the output, not the checkpoint. A run rejected with `conflict`, of the kind `stalled` or `unworkable`, raises a `runtime` error with status 409 and that `kind`; running it again gives the same answer, so a retry policy should not match it. A view still being built raises status 503, which a retry may resolve.

This workflow recalls the verdicts the brain reached on a campaign before, has a reasoning function advise on it with those verdicts in front of it, and counts the verdicts with a computation function. The recall function `campaign-reviews` is the document at the top of this page. The reasoning function `advise-on-campaign`:

```markdown
---
description: Advises whether to approve a campaign, given the verdicts the brain reached on it before
model: anthropic/claude-sonnet-4-5
input:
  schema:
    type: object
    properties:
      reviews: { type: array }
    required: [reviews]
output:
  format: json
  schema: { type: object, properties: { approve: { type: boolean } }, required: [approve], additionalProperties: false }
---

Given the verdicts this brain reached on the campaign before, {{ input.reviews | json }}, should it approve the campaign?
```

The computation function `tally-verdicts`:

```markdown
---
description: Counts the approvals and rejections among the reviews, beside the advice
language: jq
---

{ approvals: (.reviews | map(select(.verdict == "approve")) | length),
rejections: (.reviews | map(select(.verdict | startswith("reject"))) | length),
approve: .advice.approve }
```

The workflow `decide-on-campaign`:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-reviews
  name: decide-on-campaign
  version: '1.0.0'
  summary: Recalls the verdicts on a campaign, asks for advice with them, and counts them.
input:
  schema:
    document:
      type: object
      properties:
        campaign: { type: string }
      required: [campaign]
do:
  - recall:
      try:
        - remember:
            call: execute_spec
            with:
              primitive: recollection
              name: campaign-reviews
              input: { campaign: '${ .campaign }', last: 20 }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: { seconds: 5 }
          limit:
            attempt: { count: 3 }
      export:
        as: '${ { reviews: . } }'
  - advise:
      call: execute_spec
      with:
        primitive: inference
        name: advise-on-campaign
        input: { reviews: '${ $context.reviews }' }
  - tally:
      call: execute_spec
      with:
        primitive: computation
        name: tally-verdicts
        input: { reviews: '${ $context.reviews }', advice: '${ . }' }
```

`execute_spec` of `decide-on-campaign` takes an input such as `{"campaign": "spring-sale"}`. When the view is still being built, the `recall` task tries again up to three more times; when the view has stalled, the run ends `rejected` at once, and its history shows the recall function's run with the stall.

## Availability

Recall functions are available in a self-hosted runtime; Auto Cloud does not offer them until it bounds their time and memory, as for computation functions. See [Functions and availability](../concepts/functions.md#availability).

</div>
