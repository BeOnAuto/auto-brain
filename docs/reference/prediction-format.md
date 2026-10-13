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
- **The horizons**: how many periods ahead a question asks, such as next week and four weeks out, or, when the question is where a week, a month, a quarter or a year will land, that period, under `accumulates` in their place.
- **The features a trainer may use**: the other values of each event a model may learn from, each with how it is aggregated over a period.
- **What a prediction is conditioned on**: the features a question supplies for the periods ahead, such as a promotion that is already planned, named under `given`.
- **The rules**: what the trainer must follow and the model's card must state, in a line each.
- **Whether a person approves each version**: `evaluation.activate`, required, is `automatic` when a version that passes activates on its own, or names the interaction function that asks a person to approve it.
- **Who trains, and through what**: a party who reads the playbook's inbox, `source.to`, `trainer` when left out, or an interaction function that sends the build where the trainer works, `source.through`.
- **How long a build may wait for its trainer**: `source.expires`, required, from one minute to 30 days.
- **Whether the playbook has enough history**: the window must hold the holdout plus two seasons, or plus twice the longest horizon when no season is named, so weekly periods with a season of 52 need at least the holdout plus 104 weeks; a playbook without that history can upload its rows, as [An uploaded dataset](#an-uploaded-dataset) says.

## Fields

| Field                       | Meaning                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`               | Optional; what the function predicts, 1 to 1,000 characters                                                                                                                                                                               |
| `predicts.target`           | Required; the name of the quantity, which names its column in the dataset                                                                                                                                                                 |
| `predicts.period`           | Required; `day`, `week`, `month`, `quarter` or `year`                                                                                                                                                                                     |
| `predicts.season`           | Optional; the length of a season in periods, 2 to 366, such as 52 for weeks over a year                                                                                                                                                   |
| `predicts.horizons`         | Required unless `accumulates` is named; 1 to 8 whole numbers from 1 to 52, each named once: the periods ahead a question may ask                                                                                                          |
| `predicts.accumulates`      | Optional, in place of `horizons`; `week`, `month`, `quarter` or `year`, longer than `period`: a question asks for the target's total to the end of that period, as [A total to the end of a period](#a-total-to-the-end-of-a-period) says |
| `predicts.unit`             | Required; text of 1 to 64 characters for the card, such as `orders`                                                                                                                                                                       |
| `data`                      | Required; either a projection of the playbook's history, with `events`, `time`, `series`, `target` and optionally `features` and `given`, or `dataset`, the SHA-256 of an uploaded dataset; and `window` either way                       |
| `data.window`               | Required; the periods of history a model is trained on, at most 1,000                                                                                                                                                                     |
| `evaluation.holdout`        | Required; the last periods of the window held back from the trainer and used to score candidates                                                                                                                                          |
| `evaluation.metric`         | Optional; `mase` when left out, `winkler` or `quantile`                                                                                                                                                                                   |
| `evaluation.coverage_floor` | Optional; 0.5 to 0.99, 0.7 when left out: the least share of truths a candidate's interval must hold                                                                                                                                      |
| `evaluation.baselines`      | Optional; a list of `persistence` and `seasonal-naive`, each named once, a candidate must beat: `persistence` when left out, with `seasonal-naive` beside it when a season is named                                                       |
| `evaluation.confidence`     | Optional; 0.5 to 0.99, 0.9 when left out: how sure the playbook must be that a candidate beats a baseline                                                                                                                                 |
| `evaluation.shadow_periods` | Optional; 0 to 52, 0 when left out: how many periods a new version runs beside the active one before it replaces it                                                                                                                       |
| `evaluation.activate`       | Required; `automatic`, or `{ approved: <interaction function> }` to have a person approve each version                                                                                                                                    |
| `source.expires`            | Required; how long a build waits for its trainer, an ISO 8601 duration from one minute to 30 days, such as `P7D`                                                                                                                          |
| `source.to`                 | Optional; the party a build's request goes to in the inbox, text of 1 to 256 characters, `trainer` when left out                                                                                                                          |
| `source.through`            | Optional; an interaction function that sends the build to its trainer, in place of the inbox, and so never beside `to`                                                                                                                    |
| `rules`                     | Optional; at most 32 lines in words, each at most 256 bytes                                                                                                                                                                               |

The names of the target and of the features are 1 to 64 lowercase letters, digits and underscores, starting with a letter, none of them `series` or `period`, which every row has, and no feature named as the target.

The holdout holds back at least twice the longest horizon and at least 8 periods, and at most half the window. The window holds at least the holdout plus two seasons, or, when no season is named, the holdout plus twice the longest horizon.

An approver named under `evaluation.activate` is an active interaction function whose input schema takes `{ function, version, card }` and whose output schema is an object whose one required property `decision` is `approve` or `reject`. A function named under `source.through` is an active interaction function whose input schema takes `{ build: {} }` and whose answer is an object whose one required property `candidates` is a list of text. Both are checked when the prediction function is saved, so save them first.

Every problem a save finds is refused with its line, and nothing is saved.

### The input and the output

The input of a run is one of two shapes. A **question** is `{ series, horizon, given? }`: the series as text of 1 to 256 bytes, one of the function's horizons, and, when the function names `given`, the value of each given feature, by its name, and no other, which the playbook feeds to each of the periods ahead the model is fed. A **build** is `{ build: {} }`, which asks for a new version.

A question's output is the **prediction**, `{ series, origin, period, horizon, value, low, high, coverage, version }`: `origin` is the last observed period and `period` the predicted one, each in the ISO 8601 form of the grain, `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn` or `YYYY`; `value` is the 50th percentile, `low` the 10th and `high` the 90th, so `coverage` is 0.8; `version` is the version of the model that answered. A build's output is `{ version, winner, candidates }`, `version` and `winner` null when no candidate beat the baselines.

### A total to the end of a period

Where a period will land, such as a quarter's orders from the days so far, is a total, not a value some periods ahead. `predicts.accumulates` names that enclosing period, `week`, `month`, `quarter` or `year`, in place of `horizons`, and a question then asks for the target summed from the period after the last observed one to the end of the enclosing period that period falls in, so a question asked as a quarter closes predicts the next quarter whole. A day sums to a week, a month or a quarter, a week to a quarter or a year, and a month to a quarter or a year; another pair is refused at save, as are `horizons` beside `accumulates`, neither of them, and a target aggregated as `last` or `mean`, since a sum of such values says nothing. The longest horizon the holdout and the window are measured against is then the most periods the enclosing period holds: 7, 31 or 92 days, 14 or 53 weeks, or 3 or 12 months.

Such a question is `{ series, given? }`, with no horizon, and `given` holds each given feature's value for the periods summed. Its prediction's `period` is the enclosing period in that period's own ISO 8601 form, such as `2026-Q4`, `horizon` the periods summed, and `value`, `low` and `high` the total. The dataset and its files are the same as for horizons; the trainer fits a model of the total, which [the signature](#the-signature-of-a-candidate) feeds the periods it sums as `h`, and the brief reads the enclosing period as `dataset.accumulates`.

## The dataset

A forecast is at a grain and the playbook records events one by one, so the playbook keeps a **dataset** for each data part: rows keyed by series and period, folded from the events the filters name. Two functions whose data parts fold the same rows at the same grain share one dataset, and an edit that leaves the rows alone changes nothing, a wider `window` or other `given` features among them, since a build and a question read those from the same rows; an edit that changes the rows, a filter, a pointer, an aggregation, a feature or the grain, starts a new dataset from the first event of the history, and the old one is dropped once no active function names it.

| Field           | Meaning                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.events`   | 1 to 8 filters, as a recall function names its events: the event's `type`, any other attribute of the event written out, and optionally a `data` test over `$data`              |
| `data.time`     | `event` for the time of the event itself, or a JSON Pointer into its data holding an ISO 8601 time, such as `/placed_at`                                                        |
| `data.series`   | A JSON Pointer to the value that names the series, text of 1 to 256 bytes                                                                                                       |
| `data.target`   | `{ as, of }`: how the target is aggregated over a period, `count`, `sum`, `last` or `mean`, and `of`, the pointer to the value, which `count` leaves out                        |
| `data.features` | At most 40 of `{ name, of, as }`, aggregated as the target is                                                                                                                   |
| `data.given`    | The names among the features a question supplies for the periods ahead                                                                                                          |
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
| `dataset.horizons`                                  | The horizons, as a list of numbers, empty with `accumulates`                   |
| `dataset.accumulates`                               | The enclosing period of `accumulates`, null without it                         |
| `function.name`, `function.target`, `function.unit` | The function's name, its target and its unit                                   |
| `function.rules`                                    | The rules, as a list of text                                                   |

Lists have `first`, `last` and `size`. The brief is compiled when the function is saved, and rendered over the largest dataset the bounds admit, with 200,000 rows over 1,000 series; a brief that does not compile, reads a name not in `dataset` or `function`, writes a list or a mapping where text goes, renders past 64 KiB or takes longer than the 200 ms a template renders in is refused at its line. Write what the trainer needs to know that the rows do not say: what the target means, why a feature matters, what a good model must not do.

## A build

A build asks a trainer for candidate models, scores each against the rows the trainer never saw, and keeps the best as the next version of the function. Ask for one by running the function with the input `{ build: {} }` through `run_definition`, as any run is asked, so a person, a schedule and a workflow step ask the same way. The run answers `started` and waits for its trainer; `get_run` shows it until it ends.

A build is refused as it starts, its run recording that it started and was rejected and nothing else, and keeping no content, when:

| Refusal                            | When                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conflict`, `build_in_flight`      | Another build of the function is in flight, its run not ended; the words name its run. A build whose version is in its shadow or awaits its approval has ended its run, so it is not in flight                                                                                                                                                       |
| `unavailable`, `builds_full`       | The function has had its builds of the day, 4 unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise, with the because `builds_of_the_day` and the words saying when it may ask again; or the server is scoring as many builds as it may at once, `PREDICTION_BUILDS_AT_ONCE`, a build that waits for its trainer or an approval not counted |
| `unavailable`, `requests_full`     | The build would ask through the inbox and the playbook already holds as many open requests as it may                                                                                                                                                                                                                                                 |
| `unavailable`, `dataset_not_ready` | The dataset is waiting or rebuilding, or it stalled, with the because `stalled`                                                                                                                                                                                                                                                                      |
| `conflict`, `dataset_too_large`    | The dataset is past the bounds a build reads, with the figures it counted                                                                                                                                                                                                                                                                            |
| `conflict`, `unworkable`           | The brief renders past 64 KiB over this dataset                                                                                                                                                                                                                                                                                                      |

The builds in flight and the builds of the day are read from the function's models stream before the build writes anything, and claimed on that stream once its rows and its brief are written, where two builds asked at the same moment are decided one after the other: the second is refused at its claim, and the rows and the brief it wrote are kept under their digests, named by no record. The builds the server is scoring and the playbook's open requests are counted before the build is decided, so builds asked at the same moment may pass those two bounds by as many. A build refused for its dataset or its brief takes none of the day's builds.

Otherwise the build writes the two files of [The rows a build reads](#the-rows-a-build-reads), renders the brief over them and asks its trainer. With `source.to`, the default, the build is a request in the playbook's inbox: `list_interactions` lists it for its party, with a message that names the build's run id, its three routes and the opening of the brief, within 8 KiB, and its answer is `{ candidates, recipe?, limitations? }`. With `source.through`, the build starts that interaction function with the input `{ build: { run_id, function, brief_sha256, routes, expires_at } }`, and that function's request is the one the inbox lists; its answer is the build's.

### Sending a build through an interaction function

The function `source.through` names is an active interaction function of the playbook, so save it before the prediction function. Its message is all the trainer receives of the build, so it renders the build's run id, `{{ input.build.run_id }}`, and its routes, `{{ input.build.routes.brief }}`, `{{ input.build.routes.rows }}` and `{{ input.build.routes.candidates }}`; the save does not read the message. The save checks the function against the input `{ build: {} }`, so its input schema declares `build` as an object without requiring any of its fields, and its output schema is an object whose one required property `candidates` is a list of text, with `recipe` and `limitations` beside it if it takes them. This one waits in the inbox for its party; one that names a tool in `deliver` sends the build where the trainer works, as [Sending through a tool](interaction-format.md#sending-through-a-tool) says:

<!-- prettier-ignore -->
```markdown
---
description: Sends a build of a prediction function to its trainer and takes the candidates back
to: trainer
expires: P7D
input:
  schema:
    type: object
    required: [build]
    properties:
      build: { type: object }
output:
  schema:
    type: object
    required: [candidates]
    properties:
      candidates: { type: array, items: { type: string } }
      recipe: { type: string }
      limitations: { type: string }
---
Build {{ input.build.run_id }} of {{ input.build.function }} waits for its candidates until {{ input.build.expires_at }}.
Read the brief with GET {{ input.build.routes.brief }} and the training rows with GET {{ input.build.routes.rows }},
upload each candidate with POST {{ input.build.routes.candidates }}, and answer with the SHA-256 of each.
```

Saved as `send-build`, it is named in the prediction function's `source` as `through: send-build`, beside `expires` and in place of `to`.

### The trainer's path

A trainer is whoever fits the model: a person, or any agent with an environment that runs code, where it can call the runtime over HTTP, read the rows, fit a model with the libraries it needs and write the file it exports. It trains outside the playbook:

1. Find the build. `list_interactions` with `to` set to the function's party, `trainer` unless `source.to` names another, lists its request, whose `run_id` is the build's and whose message names the three routes below and how to answer; with `source.through`, the request of that function's run carries the build's `run_id` and routes in its message, as [Sending a build through an interaction function](#sending-a-build-through-an-interaction-function) says.
2. Read the brief and the training rows over the routes below, sending the key as `Authorization: Bearer <key>`.
3. Fit a model to the rows, as the brief and the rules say.
4. Export it to ONNX in [the signature of a candidate](#the-signature-of-a-candidate), within 64 MiB.
5. Upload each candidate, at most 8, and keep the SHA-256 each upload answers as `candidate`.
6. Answer the request, under the `run_id` `list_interactions` gave it, with `{ "candidates": [<the SHA-256 of each>] }` and, if the trainer wrote them, `recipe` and `limitations` in words beside them: through the tool `answer_interaction`, or over HTTP alone with `POST /v1/orgs/{org}/playbooks/{playbook}/runs/{run_id}/answer` and the body `{ "answer": { "candidates": [...] } }`, with the same key.

An agent that can only call tools, as an agent connected to the runtime over MCP alone is, cannot train: the three routes are served over HTTP alone, and fitting and exporting a model runs code. It needs an environment that runs code beside it, one that reaches the runtime over HTTP with a key that may read and write the playbook, to read, fit, export and upload; it can still find the build and answer the request itself, with the digests that environment uploaded.

| Route                                  | Answers                                    | Needs            |
| -------------------------------------- | ------------------------------------------ | ---------------- |
| `GET /runs/{run_id}/build/brief`       | The brief, as `text/markdown`, whole       | `playbook:read`  |
| `GET /runs/{run_id}/build/rows`        | The training rows, as `text/csv`, streamed | `playbook:read`  |
| `POST /runs/{run_id}/build/candidates` | `{ candidate, bytes, opset }` for a model  | `playbook:write` |

The routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`, served over HTTP alone, under the caller's own key, sent as `Authorization: Bearer <key>`, which a runtime in loopback-only local mode does not ask for, and answer only a build that waits for its answer: a run the playbook does not hold answers `not_found`, a run that is no build `conflict` with the kind `not_a_build`, and a build that took its answer or ended `conflict` with the kind `build_ended`. A candidate is the ONNX file as `application/octet-stream` with its `Content-Length`: a body without one answers 411 and one past 64 MiB 413, before the body is read. The playbook checks the file in a model process within 30 seconds and refuses it `invalid_input` when the runtime does not load it, when its signature is not the one the function feeds or its opset is older than 13, and once the build has its 8 candidates; it answers `unavailable` with the kind `model_process_busy` while every model process a build may hold is taken, since a check holds one of the processes the builds share and never one a question needs. The same accepted bytes again answer the same, and nothing is recorded for them twice; a refused file sent again is checked again and refused again. When uploads checked at the same moment would pass the eighth, the one recorded past it answers `conflict`, "The build took its 8 candidates meanwhile", and records nothing.

The answer names the candidates by their SHA-256, at most 8, each one uploaded to this build; `recipe` and `limitations` are how the candidates were trained and what they do not do well, in words, at most 8 KiB each, kept with the version. A candidate the answer names that was not uploaded is refused `invalid_input` at its pointer, and so is a `recipe` or `limitations` past 8 KiB; an answer through the function of `source.through` is checked the same way, and one that fails ends the build `rejected` with the reason `invalid_input`, its errors under `/answer`.

### The signature of a candidate

A candidate takes the target, and the features the function names, over the periods up to an origin, and answers the 10th, 50th and 90th percentiles of each step ahead:

| Tensor  | Shape       | Type    | What it is                                                                                                          |
| ------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `y`     | `[1, L]`    | float32 | The target over `L` periods up to the origin; `NaN` where a period was not observed                                 |
| `x`     | `[1, L, F]` | float32 | The features over the same periods in the document's order, present when the function names features                |
| `given` | `[1, H, G]` | float32 | The `given` features for the `H` periods ahead, in the document's order, present when the function names `given`    |
| `h`     | `[1]`       | int64   | With `accumulates`, how many periods the total sums                                                                 |
| `q`     | `[1, H, 3]` | float32 | The answer: for each step ahead, the 10th, 50th and 90th percentile; with `accumulates`, `[1, 1, 3]`, the one total |

The leading axis of every tensor is 1 or dynamic. `L` may be dynamic, and the playbook feeds the whole window, or fixed, and it feeds the last `L` periods, `NaN` before the first. `H` is the longest horizon, fixed or dynamic; with `accumulates`, the periods to the end of the enclosing period, so dynamic. The model takes no other input and answers no other output, in opset 13 or later.

### How a candidate is scored

The playbook walks each candidate, one at a time, in a model process over the scoring rows: at each of the held-back periods, the origin, it feeds the series up to that origin and reads the steps ahead that the holdout holds. It scores each horizon over every series:

- `mase`, the mean absolute error scaled by the error of the naive forecast over the training periods, one period to the next, or one season when a season is named;
- `winkler`, the width of the interval from the 10th to the 90th percentile plus ten times how far a truth falls outside it;
- `quantile`, the pinball loss of the three percentiles;
- the coverage, the share of truths the interval holds.

It walks the baselines over the same origins: `persistence` carries the last observed value forward and `seasonal-naive` takes the value one season earlier, each with an interval from its own errors over the training periods; a baseline no series can be walked by is not walked. For each baseline it estimates, by a moving-block bootstrap of the differences at each origin, 1,000 resamples drawn from a seed of the build's run id, how sure it is that the candidate is better, `p_better`. The blocks are a season long when three of them fit the origins, and otherwise the cube root of the origins rounded up, so that a season as long as the holdout never makes every resample the same.

A candidate is disqualified when its model process takes longer than 10 minutes, runs out of memory or ends, when it answers a tensor of another shape or a number that is not finite, when its interval holds fewer truths than `coverage_floor`, or when it does not beat every walked baseline with the `confidence` asked. Of the others, the one with the lowest mean of `metric` over the horizons wins.

With `accumulates`, the quantity is the total to the end of the enclosing period: `persistence` is the run-rate, the mean of the periods of the enclosing period so far times the periods left, and `seasonal-naive` the same periods' sum one season earlier, and `mase` is scaled by the error of the run-rate over the training periods.

### How a build ends

A build whose winner beats the baselines keeps it as the next version: the version's card holds the build, who trained it, the dataset's digests and figures, the file's digest, size and opset, the features, the scores, the coverage, `p_better` against each baseline, the baselines' scores and the rule it activates under, within 4 KiB, and its `recipe` and `limitations`. The run succeeds with `{ version, winner, candidates }`, each candidate with its `verdict`: `won`, `scored`, or why it was disqualified; `version` and `winner` are null when no candidate won. A build nobody answered before `source.expires` ends `rejected` with the reason `unanswered` and the kind `expired`, and a build through a function that is refused, or whose request ends unanswered, ends `rejected` with the reason `unanswered` and the kind its request ended with, `undelivered` when it has none; a build cancelled through `cancel_run` ends `rejected` with the reason `cancelled`, starting, waiting or scoring alike.

The first version a function builds activates under its rule on its holdout alone. A later one runs beside the active version for `shadow_periods` closes of the grain, of the enclosing period with `accumulates`, when the function's dataset is a projection: at each close both versions predict every series, and once the predicted periods close the predictions are graded against what happened over the series both versions predicted, a series without a truth, or one a version answered with no number or with one that is not finite, counted apart. The new version passes its shadow when its `metric` over those series is no higher than the active version's, and fails it otherwise; it fails when it predicted nothing the active version did, and passes when the active version predicted nothing. While neither has a graded series, as before the first truth arrives, the shadow is not decided and runs one more close, up to 52 closes in all: a shadow that reaches them without a graded series fails, its `shadow_failed` naming the closes that graded nothing, and the version is refused `shadow_failed`. A function over an uploaded dataset, which gains no rows, and `shadow_periods: 0` pass at once. The newest version is the one challenger: when a version is built while an earlier one is in its shadow or waits for its approval, the earlier one is refused and its approval request cancelled, and the new one runs a shadow of its own. A version that passes activates when `activate` is `automatic`; with `{ approved: <interaction function> }`, that function is asked with `{ function, version, card }`, and the version activates when it answers `approve`, naming who approved, and is not activated when it answers `reject` or nobody answers. Every outcome is a fact on the function's models stream: `version_activated` with its rule, or `activation_refused` with its `because`, `shadow_failed`, `approver_rejected`, `unanswered` or `superseded`.

`get_definition` adds, beside the dataset, `models`, the `active` version and its data digest, the `latest`, how many `versions` the function built and the `challenger` in its shadow, with its predictions, grades and result, and `build`, the newest build not yet settled, in flight, in its shadow or awaiting its approval, its `standing`, `requested_at`, `expires_at` and its candidates uploaded and scored.

### Activating a version

`POST /v1/orgs/{org}/playbooks/{playbook}/definitions/prediction/{name}/activate`, under `playbook:write` and over HTTP alone, with `{ version }`, makes a version the function built its active one, whatever its shadow or its approver decided, so an earlier version activated again is a rollback. It answers `{ function, version, rule, activated_at }`, `not_found` for a version the function did not build and `conflict` with the kind `already_active` for the active one.

## A question

A question, `{ series, horizon, given? }`, or `{ series, given? }` with `accumulates`, is answered by the active version from the series' last window: the dataset's rows up to the last closed period at its checkpoint, or the last period of an uploaded dataset, which a model process reads from the upload so the server parses none of it. The model process that holds the version's file answers it within 10 seconds. The output is the prediction of [The input and the output](#the-input-and-the-output), and the run's record holds the `version`, the `origin`, the `dataset_checkpoint` and the `duration_ms`. A question is refused `conflict` with the kind `no_active_version` before a version is active, and with the kind `data_changed` once the data part, the `horizons`, the `given` features or `accumulates` changed since the active version was built, since its model was built for them; `invalid_input` for a series the dataset does not hold; `unavailable` with the kind `dataset_not_ready` while the dataset is not live, with the because `stalled` once it stalled, `model_process_busy` while every model process is taken, and `model_process_failed` when the model process ends before it answers, or, with the because `not_finite`, when the model answers a number that is not finite, which asking again does not change.

## How a run ends

| Ending                                     | When                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                | A question was answered: the prediction is its output                                                                                                                                                           |
| `succeeded`                                | A build scored every candidate its answer named: `{ version, winner, candidates }` is its output, `version` and `winner` null when none won or none was named                                                   |
| `invalid_input`                            | The input is neither a question the function takes nor `{ build: {} }`, or a question names a series the dataset does not hold in its window, at `/series`                                                      |
| `conflict`, kind `no_active_version`       | A question asked before any version is active                                                                                                                                                                   |
| `conflict`, kind `data_changed`            | A question asked once the data part, the `horizons`, the `given` features or `accumulates` changed since the active version was built                                                                           |
| `unavailable`, kind `dataset_not_ready`    | A question or a build while the dataset is waiting or rebuilding, or, with the because `stalled`, once it stalled                                                                                               |
| `unavailable`, kind `model_process_busy`   | A question found every model process taken                                                                                                                                                                      |
| `unavailable`, kind `model_process_failed` | A question's model process ended before it answered, as when it ran out of time or memory; with the because `not_finite`, the model answered a number that is not finite or a shape its signature does not give |
| The refusals of [A build](#a-build)        | A build refused as it starts: `build_in_flight`, `builds_full`, `requests_full`, `dataset_too_large` or `unworkable`                                                                                            |
| `rejected` as `unanswered`, kind `expired` | Nobody answered a build's request before `source.expires`                                                                                                                                                       |
| `rejected` as `unanswered`                 | A build through `source.through` whose function's run ended without an answer: with that run's kind when it ended `unanswered`, and `undelivered` for any other ending or when it could not start               |
| `rejected` as `invalid_input`              | A build through `source.through` whose function answered a candidate not uploaded to the build, or a `recipe` or `limitations` past 8 KiB, its errors under `/answer`                                           |
| `rejected` as `cancelled`                  | A build cancelled through `cancel_run`, starting, waiting or scoring alike, with the kind `requested`, or by the workflow that waited for it, which ran out of time or ended first                              |
| `failed`                                   | The runtime itself broke down                                                                                                                                                                                   |

A question ends within its call and cannot be cancelled while it runs; a build finishes later, so `run_definition` answers it `started` and `get_run` shows how it ended. A build's history shows `dataset_assembled`, with the digests and the figures of its two files, each candidate taken or refused as `candidate_uploaded` or `candidate_refused`, an inbox build's answer as `request_answered`, each candidate's score as `candidate_scored` or `candidate_disqualified`, each baseline as `baseline_scored` or `baseline_not_walked`, and the run's end. The function's own facts are on its models stream, `models/<function>`, among the playbook's events: `build_asked` and `build_ended` for each build, `version_built` with the card, `shadow_predicted` and `shadow_graded` as the shadow's periods close, `shadow_passed` or `shadow_failed`, and `version_activated` or `activation_refused`. A version's `recipe` and `limitations` are kept as content, which `get_event` shows whole beside their digests in its `version_built`.

## Bounds

| Bound                    | Value                                                                                                                                                                          | When it is reached                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Horizons                 | 1 to 8, each 1 to 52 periods                                                                                                                                                   | The save is refused                                                        |
| A total                  | A day to a week, a month or a quarter, at most 7, 31 or 92 days; a week to a quarter or a year, at most 14 or 53 weeks; a month to a quarter or a year, at most 3 or 12 months | The save is refused                                                        |
| Holdout                  | At least twice the longest horizon and at least 8, at most half the window                                                                                                     | The save is refused                                                        |
| Window                   | At least the holdout plus two seasons, or plus twice the longest horizon; at most 1,000                                                                                        | The save is refused                                                        |
| Season                   | 2 to 366 periods                                                                                                                                                               | The save is refused                                                        |
| Shadow periods           | 0 to 52                                                                                                                                                                        | The save is refused                                                        |
| Filters, features, rules | 8 filters; 40 features; 32 rules of 256 bytes each                                                                                                                             | The save is refused                                                        |
| A build's wait           | One minute to 30 days                                                                                                                                                          | The save is refused                                                        |
| The brief                | 64 KiB rendered over the largest dataset, within the 200 ms a template renders in                                                                                              | The save is refused                                                        |
| A series                 | 1 to 256 bytes of text                                                                                                                                                         | The event is passed over                                                   |
| A dataset                | 200,000 rows over 1,000 series, 64 MiB as CSV                                                                                                                                  | A build is refused; an upload is refused                                   |
| Functions a playbook     | 32 active, unless the server's `PREDICTION_MAX_FUNCTIONS` says otherwise, from 1 to 1,000                                                                                      | The save is refused                                                        |
| A question's run         | 10 seconds from when its job holds a model process, after a wait of up to 10 seconds for one; over an uploaded dataset, a window job bounded alike before it                   | The run ends `unavailable`, `model_process_busy` or `model_process_failed` |
| A build's run            | Its wait, the scoring of eight candidates at ten minutes each, and a minute to start                                                                                           | The run ends                                                               |
| Builds a function a day  | 4, unless the server's `PREDICTION_BUILDS_PER_DAY` says otherwise, from 1 to 100                                                                                               | The build is refused                                                       |
| Candidates of a build    | 8, each a file of at most 64 MiB with its `Content-Length`                                                                                                                     | The upload is refused                                                      |
| A candidate's check      | 30 seconds to load in a model process                                                                                                                                          | The upload is refused                                                      |
| A candidate's scoring    | 10 minutes in a model process                                                                                                                                                  | The candidate is disqualified                                              |
| A recipe, a limitation   | 8 KiB of text each                                                                                                                                                             | The answer is refused                                                      |
| A version's card         | 4 KiB as JSON                                                                                                                                                                  | Its features are kept apart                                                |

## In a workflow

A workflow calls a prediction function as it calls any function, with `call: run_definition` and `type: prediction`, and the task's output is the run's output, as [Calling a function](workflow-format.md#calling-a-function) says. A question written out, such as `{ call: run_definition, with: { type: prediction, name: weekly-orders, input: { series: north, horizon: 1, given: { promotion: 1 } } } }`, ends within its call, and the task waits at most 10 seconds and a minute for it. A build, `input: { build: {} }`, waits for its trainer, and the task waits for it as long as the build may take, its `source.expires`, the scoring of eight candidates at ten minutes each and a minute to start, and a minute more, never past the longest the workflow itself may still run, holding nothing of the server meanwhile; its output is `{ version, winner, candidates }`, so the next task can branch on `version`, null when no candidate won. A task whose input holds an expression, as the one below does, waits as long as a build, since what it asks is known only when it runs.

This workflow forecasts a region's orders for next week from `weekly-orders`, given whether a promotion is planned, and answers that there is no forecast yet while the function has no active version:

```yaml
document:
  dsl: '1.0.3'
  namespace: orders
  name: next-week-orders
  version: '1.0.0'
  summary: Forecasts a region's orders for next week, or answers none while no version is active.
input:
  schema:
    document:
      type: object
      properties:
        region: { type: string }
        promotion: { type: number }
      required: [region, promotion]
do:
  - forecast:
      try:
        - ask:
            call: run_definition
            with:
              type: prediction
              name: weekly-orders
              input:
                series: '${ $data.region }'
                horizon: 1
                given: { promotion: '${ $data.promotion }' }
            output:
              as: '${ ({ forecast: $data }) }'
      catch:
        errors:
          with: { status: 409 }
        when: '${ $error.kind == "no_active_version" }'
        do:
          - none: { set: { forecast: null } }
```

`run_definition` of `next-week-orders` takes an input such as `{"region": "north", "promotion": 1}`. Before `weekly-orders` has an active version, its question is refused `conflict` with the kind `no_active_version`, which the `catch` takes, and the run succeeds with `{"forecast": null}`; once a version is active, the run succeeds with `{"forecast": <the prediction>}`, its `series`, `origin`, `period`, `horizon`, `value`, `low`, `high`, `coverage` and `version`. Any other refusal ends the workflow's run, as the next paragraph says.

A run that does not succeed raises the error of its rejection. A build nobody answered raises the [problem type](http.md#responses-and-errors) `https://on.auto/problems/unanswered`, status 410, with the kind `expired`, which no retry policy matches unless it names that type, so a workflow handles an unanswered build only on purpose. A refusal raises status 503 for `unavailable` and 409 for `conflict`, with its kind and its because: `model_process_busy`, and a dataset still being built, pass with time, so a retry on status 503 suits a question, while `builds_full` with the because `builds_of_the_day`, a `stalled` dataset and a `not_finite` answer do not change when they are tried again, and neither do `no_active_version` and `data_changed` until a build makes a version, so leave 409 out of a retry policy and read `$error.because` in a `when` to leave out the rest. A workflow on a [schedule](workflow-format.md#triggers) asks for a build on that schedule, within the builds a function may ask in a day.

## Availability

Prediction functions are available in a self-hosted runtime, which keeps the dataset of each saved prediction function, takes uploaded datasets, checks and scores the candidates trainers upload, keeps the winners as versions and answers questions from the active version, each model in a model process of the server. A trainer fits its models outside the runtime. See [Functions and availability](../concepts/functions.md#availability).

</div>
