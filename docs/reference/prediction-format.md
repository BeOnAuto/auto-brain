<div v-pre>

# Prediction function format

The API stores a prediction function as a definition of the type `prediction`. A prediction function answers a question with numbers learned from the playbook's own history: a quantity over a grain of time, one or more periods ahead, for one series at a time, as a likely value with a low and a high. Its source document says what it predicts, the data it learns from, how a candidate model is judged, where a request to train one goes and the rules a trainer follows, and holds the **brief**, the text a trainer reads first.

Keep three things apart: the function, which is the definition and does not change when a model does; the **dataset**, the rows the playbook keeps for it, folded from its history or uploaded; and the model, a file in the ONNX format that a trainer builds outside the playbook from those rows. The playbook keeps the dataset from the moment the function is saved. It scores the models trainers send, keeps the winner as a version of the function and answers questions from the active version, as [A build](#a-build) and [A question](#a-question) say.

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

## A build

A build asks a trainer for candidate models, scores each against the rows the trainer never saw, and keeps the best as the next version of the function. Ask for one by running the function with the input `{ build: {} }` through `run_definition`, as any run is asked, so a person, a schedule and a workflow step ask the same way. The run answers `started` and waits for its trainer; `get_run` shows it until it ends.

A build is refused as it starts, its run recording that it started and was rejected and nothing else, when:

| Refusal                            | When                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conflict`, `build_in_flight`      | Another build of the function is in flight; the words name its run                                                                                          |
| `unavailable`, `builds_full`       | The function has had its builds of the day, 4 unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise, or the server scores as many builds as it may |
| `unavailable`, `requests_full`     | The build would ask through the inbox and the playbook already holds as many open requests as it may                                                        |
| `unavailable`, `dataset_not_ready` | The dataset is waiting, rebuilding or stalled                                                                                                               |
| `conflict`, `dataset_too_large`    | The dataset is past the bounds a build reads, with the figures it counted                                                                                   |
| `conflict`, `unworkable`           | The brief renders past 64 KiB over this dataset                                                                                                             |

Otherwise the build writes the two files of [The rows a build reads](#the-rows-a-build-reads), renders the brief over them and asks its trainer. With `source.to`, the default, the build is a request in the playbook's inbox: `list_interactions` lists it for its party, with a message that names the build's run id, its three routes and the opening of the brief, within 8 KiB, and its answer is `{ candidates, recipe?, limitations? }`. With `source.through`, the build starts that interaction function with the input `{ build: { run_id, function, brief_sha256, routes, expires_at } }`, and that function's request is the one the inbox lists; its answer is the build's.

### The trainer's path

A trainer, a person or an agent with the skills and the tools to train, reads the brief, reads the training rows, trains a model outside the playbook, exports it to ONNX in the signature below, uploads it, and answers the request with the SHA-256 the upload answered:

| Route                                  | Answers                                    | Needs            |
| -------------------------------------- | ------------------------------------------ | ---------------- |
| `GET /runs/{run_id}/build/brief`       | The brief, as `text/markdown`, whole       | `playbook:read`  |
| `GET /runs/{run_id}/build/rows`        | The training rows, as `text/csv`, streamed | `playbook:read`  |
| `POST /runs/{run_id}/build/candidates` | `{ candidate, bytes, opset }` for a model  | `playbook:write` |

The routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`, served over HTTP alone, under the caller's own key, and answer only a build that waits for its answer: another run answers `conflict` with the kind `not_a_build`, and a build that took its answer or ended `conflict` with the kind `build_ended`. A candidate is the ONNX file as `application/octet-stream` with its `Content-Length`: a body without one answers 411 and one past 64 MiB 413, before the body is read. The playbook checks the file in a model process within 30 seconds and refuses it `invalid_input` when the runtime does not load it, when its signature is not the one the function feeds or its opset is older than 13, and once the build has its 8 candidates; it answers `unavailable` with the kind `model_process_busy` while every model process is taken. The same bytes again answer the same, and nothing is recorded for them twice.

The answer names the candidates by their SHA-256, at most 8, each one uploaded to this build; `recipe` and `limitations` are how the candidates were trained and what they do not do well, in words, at most 8 KiB each, kept with the version. A candidate the answer names that was not uploaded is refused `invalid_input` at its pointer.

### The signature of a candidate

A candidate takes the target, and the features the function names, over the periods up to an origin, and answers the 10th, 50th and 90th percentiles of each step ahead:

| Tensor  | Shape       | Type    | What it is                                                                                                          |
| ------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `y`     | `[1, L]`    | float32 | The target over `L` periods up to the origin; `NaN` where a period was not observed                                 |
| `x`     | `[1, L, F]` | float32 | The features over the same periods in the document's order, present when the function names features                |
| `given` | `[1, H, G]` | float32 | The `given` features for the `H` periods ahead, in the document's order, present when the function names `given`    |
| `h`     | `[1]`       | int64   | With `accumulates`, how many periods the total sums                                                                 |
| `q`     | `[1, H, 3]` | float32 | The answer: for each step ahead, the 10th, 50th and 90th percentile; with `accumulates`, `[1, 1, 3]`, the one total |

`L` may be dynamic, and the playbook feeds the whole window, or fixed, and it feeds the last `L` periods, `NaN` before the first. `H` is the longest horizon, fixed or dynamic; with `accumulates`, the periods to the end of the enclosing period, so dynamic. The model takes no other input and answers no other output, in opset 13 or later.

### How a candidate is scored

The playbook walks each candidate, one at a time, in a model process over the scoring rows: at each of the held-back periods, the origin, it feeds the series up to that origin and reads the steps ahead that the holdout holds. It scores each horizon over every series:

- `mase`, the mean absolute error scaled by the error of the naive forecast over the training periods, one period to the next, or one season when a season is named;
- `winkler`, the width of the interval from the 10th to the 90th percentile plus ten times how far a truth falls outside it;
- `quantile`, the pinball loss of the three percentiles;
- the coverage, the share of truths the interval holds.

It walks the baselines over the same origins: `persistence` carries the last observed value forward and `seasonal-naive` takes the value one season earlier, each with an interval from its own errors over the training periods; a baseline no series can be walked by is not walked. For each baseline it estimates, by a moving-block bootstrap of the differences at each origin, 1,000 resamples drawn from a seed of the build's run id, how sure it is that the candidate is better, `p_better`.

A candidate is disqualified when its model process takes longer than 10 minutes, runs out of memory or ends, when it answers a tensor of another shape or a number that is not finite, when its interval holds fewer truths than `coverage_floor`, or when it does not beat every walked baseline with the `confidence` asked. Of the others, the one with the lowest mean of `metric` over the horizons wins.

With `accumulates`, the quantity is the total to the end of the enclosing period: `persistence` is the run-rate, the mean of the periods of the enclosing period so far times the periods left, and `seasonal-naive` the same periods' sum one season earlier, and `mase` is scaled by the error of the run-rate over the training periods.

### How a build ends

A build whose winner beats the baselines keeps it as the next version: the version's card holds the build, who trained it, the dataset's digests and figures, the file's digest, size and opset, the features, the scores, the coverage, `p_better` against each baseline, the baselines' scores and the rule it activates under, within 4 KiB, and its `recipe` and `limitations`. The run succeeds with `{ version, winner, candidates }`, each candidate with its `verdict`: `won`, `scored`, or why it was disqualified; `version` and `winner` are null when no candidate won. A build nobody answered before `source.expires` ends `rejected` with the reason `unanswered` and the kind `expired`, and a build through a function that is refused, or whose request ends unanswered, ends `rejected` with the reason `unanswered` and the kind its request ended with, `undelivered` when it has none; a build cancelled through `cancel_run` ends `rejected` with the reason `cancelled`, starting, waiting or scoring alike.

The first version a function builds activates under its rule on its holdout alone. A later one runs beside the active version for `shadow_periods` closes of the grain, of the enclosing period with `accumulates`, when the function's dataset is a projection: at each close both versions predict every series, and once the predicted periods close the predictions are graded against what happened, a series without a truth counted apart. The new version passes its shadow when its `metric` is no worse than the active version's, and fails it otherwise; a function over an uploaded dataset, which gains no rows, and `shadow_periods: 0` pass at once. A version that passes activates when `activate` is `automatic`; with `{ approved: <interaction function> }`, that function is asked with `{ function, version, card }`, and the version activates when it answers `approve`, naming who approved, and is not activated when it answers `reject` or nobody answers.

`get_definition` adds, beside the dataset, `models`, the `active` version and its data digest, the `latest`, how many `versions` the function built and the `challenger` in its shadow, with its predictions, grades and result, and `build`, the build in flight, its `standing`, `requested_at`, `expires_at` and its candidates uploaded and scored.

### Activating a version

`POST /v1/orgs/{org}/playbooks/{playbook}/definitions/prediction/{name}/activate`, under `playbook:write` and over HTTP alone, with `{ version }`, makes a version the function built its active one, whatever its shadow or its approver decided, so an earlier version activated again is a rollback. It answers `{ function, version, rule, activated_at }`, `not_found` for a version the function did not build and `conflict` with the kind `already_active` for the active one.

## A question

A question, `{ series, horizon, given? }`, is answered by the active version from the series' last window: the dataset's rows up to the last closed period at its checkpoint, or the last period of an uploaded dataset. The model process that holds the version's file answers it within 10 seconds. The output is the prediction of [The input and the output](#the-input-and-the-output), and the run's record holds the `version`, the `origin`, the `dataset_checkpoint` and the `duration_ms`. A question is refused `conflict` with the kind `no_active_version` before a version is active, and with the kind `data_changed` once the data part changed since the active version was built; `invalid_input` for a series the dataset does not hold; `unavailable` with the kind `dataset_not_ready` while the dataset is not live, `model_process_busy` while every model process is taken, and `model_process_failed` when the model process ends before it answers or answers a number that is not finite.

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
| Builds a function a day  | 4, unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise, from 1 to 100          | The build is refused                     |
| Candidates of a build    | 8, each a file of at most 64 MiB with its `Content-Length`                                | The upload is refused                    |
| A candidate's check      | 30 seconds to load in a model process                                                     | The upload is refused                    |
| A candidate's scoring    | 10 minutes in a model process                                                             | The candidate is disqualified            |
| A recipe, a limitation   | 8 KiB of text each                                                                        | The answer is refused                    |
| A version's card         | 4 KiB as JSON                                                                             | Its features are kept apart              |

## Availability

This runtime keeps the dataset of a saved prediction function, takes uploaded datasets, builds versions from what trainers send and answers questions from the active version, each in a model process of the server. See [Functions and availability](../concepts/functions.md#availability).

</div>
