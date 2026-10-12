<div v-pre>

# Prediction function format

The API stores a prediction function as a definition of the type `prediction`. A prediction function answers a question with numbers learned from the playbook's own history: a quantity over a grain of time, one or more periods ahead, for one series at a time, as a likely value with a low and a high. Its source document says what it predicts, the data it learns from, how a candidate model is judged, where a request to train one goes and the rules a trainer follows, and holds the **brief**, the text a trainer reads first.

Keep three things apart: the function, which is the definition and does not change when a model does; the **dataset**, the rows the playbook keeps for it, folded from its history or uploaded; and the model, a file in the ONNX format that a trainer builds outside the playbook from those rows. The playbook keeps the dataset from the moment the function is saved. It scores the models trainers send, keeps the winner as a version of the function and answers questions from the active version; see [Availability](#availability) for what this runtime offers today.

## A function document

The source is Markdown with YAML front matter followed by the brief. This example predicts the orders of each region one and four weeks ahead, from the events `order.placed` the playbook records:

<!-- prettier-ignore -->
```markdown
---
description: Predicts the orders of each region one and four weeks ahead
predicts:
  target: orders
  period: week
  season: 52
  horizons: [1, 4]
  unit: orders
data:
  events:
    - type: order.placed
  time: /placed_at
  series: /region
  target: { as: count }
  features:
    - { name: basket, of: /total, as: mean }
    - { name: promotion, of: /promotion, as: last }
  given: [promotion]
  window: 156
evaluation:
  holdout: 12
  activate: automatic
source:
  expires: P7D
rules:
  - Train on the rows given and on nothing else
---
Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},
over {{ dataset.window }} weeks from {{ dataset.periods.first }} to {{ dataset.periods.last }}.
Predict {{ dataset.horizons | join: " and " }} weeks ahead. The features are
{% for feature in dataset.features %}{{ feature.name }} ({{ feature.as }}){% unless forloop.last %}, {% endunless %}{% endfor %}.
{% for rule in function.rules %}- {{ rule }}
{% endfor %}
```

`create_definition` takes `type: "prediction"`, a function `name` such as `weekly-orders` and the document as `source`. A saved prediction function has the `media_type` `text/markdown`, and its `input_schema` and `output_schema` are derived from the document; a document that names `input` or `output` is refused, since the playbook writes both itself.

Before writing one, establish with the person:

- **The target and its grain**: the one quantity to predict, how it is read from each event, and the period it is counted over, a day, a week, a month, a quarter or a year.
- **The horizons**: how many periods ahead a question asks, such as next week and four weeks out.
- **The features a trainer may use**: the other values of each event a model may learn from, each with how it is aggregated over a period.
- **What a prediction is conditioned on**: the features a question supplies for the period it asks about, such as a promotion that is already planned, named under `given`.
- **The rules**: what the trainer must follow and the model's card must state, in a line each.

## Fields

| Field                       | Meaning                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`               | Optional; what the function predicts, 1 to 1,000 characters                                                                                                                                                         |
| `predicts.target`           | Required; the name of the quantity, which names its column in the dataset                                                                                                                                           |
| `predicts.period`           | Required; `day`, `week`, `month`, `quarter` or `year`                                                                                                                                                               |
| `predicts.season`           | Optional; the length of a season in periods, 2 to 366, such as 52 for weeks over a year                                                                                                                             |
| `predicts.horizons`         | Required; 1 to 8 whole numbers from 1 to 52, each named once: the periods ahead a question may ask                                                                                                                  |
| `predicts.unit`             | Required; text of 1 to 64 characters for the card, such as `orders`                                                                                                                                                 |
| `data`                      | Required; either a projection of the playbook's history, with `events`, `time`, `series`, `target` and optionally `features` and `given`, or `dataset`, the SHA-256 of an uploaded dataset; and `window` either way |
| `data.window`               | Required; the periods of history a model is trained on, at most 1,000                                                                                                                                               |
| `evaluation.holdout`        | Required; the last periods of the window held back from the trainer and used to score candidates                                                                                                                    |
| `evaluation.metric`         | Optional; `mase` when left out, `winkler` or `quantile`                                                                                                                                                             |
| `evaluation.coverage_floor` | Optional; 0.5 to 0.99, 0.7 when left out: the least share of truths a candidate's interval must hold                                                                                                                |
| `evaluation.baselines`      | Optional; a list of `persistence` and `seasonal-naive`, each named once, a candidate must beat: `persistence` when left out, with `seasonal-naive` beside it when a season is named                                 |
| `evaluation.confidence`     | Optional; 0.5 to 0.99, 0.9 when left out: how sure the playbook must be that a candidate beats a baseline                                                                                                           |
| `evaluation.shadow_periods` | Optional; 0 to 52, 0 when left out: how many periods a new version runs beside the active one before it replaces it                                                                                                 |
| `evaluation.activate`       | Required; `automatic`, or `{ approved: <interaction function> }` to have a person approve each version                                                                                                              |
| `source.expires`            | Required; how long a build waits for its trainer, an ISO 8601 duration from one minute to 30 days, such as `P7D`                                                                                                    |
| `source.to`                 | Optional; the party a build's request goes to in the inbox, text of 1 to 256 characters, `trainer` when left out                                                                                                    |
| `source.through`            | Optional; an interaction function that sends the build to its trainer, in place of the inbox, and so never beside `to`                                                                                              |
| `rules`                     | Optional; at most 32 lines in words, each at most 256 bytes                                                                                                                                                         |

The names of the target and of the features are 1 to 64 lowercase letters, digits and underscores, starting with a letter, none of them `series` or `period`, which every row has, and no feature named as the target.

The holdout holds back at least twice the longest horizon and at least 8 periods, and at most half the window. The window holds at least the holdout plus two seasons, or, when no season is named, the holdout plus twice the longest horizon.

An approver named under `evaluation.activate` is an active interaction function whose input schema takes `{ function, version, card }` and whose output schema is an object whose one required property `decision` is `approve` or `reject`. A function named under `source.through` is an active interaction function whose input schema takes `{ build: {} }` and whose answer is an object whose one required property `candidates` is a list of text. Both are checked when the prediction function is saved, so save them first.

Every problem a save finds is refused with its line, and nothing is saved.

### The input and the output

The input of a run is one of two shapes. A **question** is `{ series, horizon, given? }`: the series as text of 1 to 256 bytes, one of the function's horizons, and, when the function names `given`, the value of each given feature for the period asked about, by its name, and no other. A **build** is `{ build: {} }`, which asks for a new version.

A question's output is the **prediction**, `{ series, origin, period, horizon, value, low, high, coverage, version }`: `origin` is the last observed period and `period` the predicted one, each in the ISO 8601 form of the grain, `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn` or `YYYY`; `value` is the 50th percentile, `low` the 10th and `high` the 90th, so `coverage` is 0.8; `version` is the version of the model that answered. A build's output is `{ version, winner, candidates }`, `version` and `winner` null when no candidate beat the baselines.

## The dataset

A forecast is at a grain and the playbook records events one by one, so the playbook keeps a **dataset** for each data part: rows keyed by series and period, folded from the events the filters name. Two functions whose data parts fold the same rows at the same grain share one dataset, and an edit that leaves the rows alone changes nothing, a wider `window` or other `given` features among them, since a build and a question read those from the same rows; an edit that changes the rows, a filter, a pointer, an aggregation, a feature or the grain, starts a new dataset from the first event of the history, and the old one is dropped once no active function names it.

| Field           | Meaning                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.events`   | 1 to 8 filters, as a recall function names its events: the event's `type`, any other attribute of the event written out, and optionally a `data` test over `$data`              |
| `data.time`     | `event` for the time of the event itself, or a JSON Pointer into its data holding an ISO 8601 time, such as `/placed_at`                                                        |
| `data.series`   | A JSON Pointer to the value that names the series, text of 1 to 256 bytes                                                                                                       |
| `data.target`   | `{ as, of }`: how the target is aggregated over a period, `count`, `sum`, `last` or `mean`, and `of`, the pointer to the value, which `count` leaves out                        |
| `data.features` | At most 40 of `{ name, of, as }`, aggregated as the target is                                                                                                                   |
| `data.given`    | The names among the features a question supplies for the period it asks about                                                                                                   |
| `data.dataset`  | In place of the projection: the SHA-256 of a dataset uploaded as [An uploaded dataset](#an-uploaded-dataset) says, with `features` naming its columns after the target in order |

A `time` or a `series` that points where none of the named event types holds a value, such as `/output/region` under an event `run_rejected`, is refused at save, as a recall function's filters are checked.

For each event a filter takes, in the order the playbook recorded them, the dataset reads the time, in UTC, and finds its period: a week runs from Monday and is numbered as ISO 8601 numbers weeks, so `2026-W01` starts on 2025-12-29, and a quarter is three calendar months. It reads the series, then the target and each feature, and adds the event to the row of that series and period: `count` adds one, `sum` adds the value, `last` takes the value of the latest event by its time, whatever order the events were recorded in, and `mean` keeps the sum and the count. A value that is missing or null adds nothing.

The dataset passes over an event whose time is not an ISO 8601 time with its offset on a day of the calendar, a date alone among them, or names a leap second; whose series is not text of 1 to 256 bytes; whose target or feature is a value that is not a finite number; or whose data test fails. It counts each and notes it in the server's log, and the event adds to no row. A data test that runs out of time or memory meets a limit no event causes, so its event is never passed over: the dataset stops before that event and tries it again at the server's next sweep, a second later by default, and after twenty tries without a page folded whole it stalls, its phase `stalled`, notes it in the server's log, and folds nothing more. A data part that changes starts a dataset of its own.

`get_definition` of a prediction function adds its `standing`: the dataset's `kind`, `projection` or `uploaded`, its `data_sha256`, its `phase`, `waiting` for a slot to be built, `rebuilding` from the history, `live` or `stalled`, its `checkpoint` and `checkpoint_at`, the `rows` and `series` it holds, its `first_period` and `last_period`, the `events_folded`, the events `passed_over`, and its `stall`, null unless it stalled and then `{ record, detail }`, the event it stopped at and why. A function that names an uploaded dataset has no projection, and its standing says so.

### The rows a build reads

A build reads the dataset as two files in CSV, each kept under its SHA-256 and both read at one checkpoint of the dataset, however far it folds on while they are written: the **training rows**, which a trainer reads, and the **scoring rows**, which only the playbook reads. Both cover the window: a dense grid of the `window` periods that ends at the last period closed when the build starts. The training rows leave out the last `holdout` periods; the scoring rows hold them too.

The header is `series,period,` followed by the target and the features in the document's order, such as `series,period,orders,basket,promotion`. Each row is one series and one period, sorted by series, as their UTF-8 bytes sort, and then by period; a period is written in the ISO 8601 form of the grain and each value as a JSON number. A period with no event is 0 for `count` and `sum`, a real observation of nothing, and an empty cell for `last` and `mean`, as is a feature no event of the period carried. A series observed in fewer than the holdout plus one periods of the window is left out. The files are UTF-8 as RFC 4180 writes CSV, each record ended by CRLF:

```text
series,period,orders,basket,promotion
north,2026-W40,2,30,1
north,2026-W41,0,,
"south, coast",2026-W40,1,12.5,
"south, coast",2026-W41,0,,
```

### An uploaded dataset

A playbook that has no history yet can be given its rows. Upload them with `PUT /v1/orgs/{org}/playbooks/{playbook}/datasets/{sha256}`, under `playbook:write`, with the body as `text/csv` and its `Content-Length`, at most 64 MiB, and `sha256` the SHA-256 of the body. The body follows the grammar above with any target and feature names: the header `series,period` and then the columns, rows sorted by series and then period, one row a series and period, every period in one ISO 8601 form, each value a JSON number or empty, at most 200,000 rows over at most 1,000 series. The upload is HTTP alone, not a tool.

The answer is `{ dataset, bytes, rows, series, columns, period, first_period, last_period }`. A body that breaks the grammar is refused `invalid_input` with the line of its first fault, and one whose digest is not the path's with both digests; nothing is kept then. A function names the dataset as `data.dataset`, and its save checks that this playbook keeps it, that its rows are of the grain `predicts.period` names, and that its header names `predicts.target` and then the features of `data.features` in their order, refusing each fault at its line:

<!-- prettier-ignore -->
```yaml
data:
  dataset: 3f2ac1d0e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d
  features: [basket, promotion]
  given: [promotion]
  window: 156
```

## The brief

The body of the document is the brief, a Liquid template a build renders for the trainer. It reads two variables and nothing else:

| Variable                                            | Value                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dataset.rows`, `dataset.series`                    | How many rows and series the training rows hold                                |
| `dataset.periods`                                   | `grain`, `season`, null when none is named, and the `first` and `last` periods |
| `dataset.window`, `dataset.holdout`                 | The window and the periods held back                                           |
| `dataset.features`                                  | A list of `{ name, as, given }`, `as` null for an uploaded dataset             |
| `dataset.horizons`                                  | The horizons, as a list of numbers                                             |
| `function.name`, `function.target`, `function.unit` | The function's name, its target and its unit                                   |
| `function.rules`                                    | The rules, as a list of text                                                   |

Lists have `first`, `last` and `size`. The brief is compiled when the function is saved, and rendered over the largest dataset the bounds admit, with 200,000 rows over 1,000 series; a brief that does not compile, reads a name not in `dataset` or `function`, writes a list or a mapping where text goes, renders past 64 KiB or takes longer than the 200 ms a template renders in is refused at its line. Write what the trainer needs to know that the rows do not say: what the target means, why a feature matters, what a good model must not do.

## Bounds

| Bound                    | Value                                                                                     | When it is reached                       |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| Horizons                 | 1 to 8, each 1 to 52 periods                                                              | The save is refused                      |
| Holdout                  | At least twice the longest horizon and at least 8, at most half the window                | The save is refused                      |
| Window                   | At least the holdout plus two seasons, or plus twice the longest horizon; at most 1,000   | The save is refused                      |
| Season                   | 2 to 366 periods                                                                          | The save is refused                      |
| Shadow periods           | 0 to 52                                                                                   | The save is refused                      |
| Filters, features, rules | 8 filters; 40 features; 32 rules of 256 bytes each                                        | The save is refused                      |
| A build's wait           | One minute to 30 days                                                                     | The save is refused                      |
| The brief                | 64 KiB rendered over the largest dataset, within the 200 ms a template renders in         | The save is refused                      |
| A series                 | 1 to 256 bytes of text                                                                    | The event is passed over                 |
| A dataset                | 200,000 rows over 1,000 series, 64 MiB as CSV                                             | A build is refused; an upload is refused |
| Functions a playbook     | 32 active, unless the server's `PREDICTION_MAX_FUNCTIONS` says otherwise, from 1 to 1,000 | The save is refused                      |
| A question's run         | 10 seconds within its call                                                                | The run ends                             |
| A build's run            | Its wait, the scoring of eight candidates at ten minutes each, and a minute to start      | The run ends                             |

## Availability

This runtime keeps the dataset of a saved prediction function and takes uploaded datasets, but does not offer a build or a prediction yet: a question is refused `conflict` with the kind `no_active_version`, since no version can be built, and a build is refused `unavailable` with the kind `build_not_offered`, which asking again does not change. See [Functions and availability](../concepts/functions.md#availability).

</div>
