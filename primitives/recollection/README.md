# @beonauto/recollection

The implementation of recall functions. A recall function keeps a view of its brain's own history: its fold, a program in jq, folds each event its filters name into the view, the host keeps the view as the brain records events, and a run answers from the view as it stands, applying the function's `answer` to it with the run's input. Its API identifier and package name are `recollection`; in text a user reads it is a recall function, and what it keeps its view.

A recall function retrieves or reconstructs relevant information from configured sources, as [Brain terminology](../../docs/concepts/terminology.md) says. This package implements the source that exists today, the brain's own history; documents, files and other connected sources are not implemented, and neither is semantic search over text.

User documentation is [Recall function format](../../docs/reference/recall-format.md), published at [on.auto/docs](https://on.auto/docs/): the document, the events, the fold's contract, how the view is kept, the endings and the bounds. Update it alongside behaviour changes; `src/document/reference-example.test.ts` checks that its example is the document the tests run, folds to the view it shows and answers the output it shows.

## The document

`parseRecallDocument(source)` reads a document with the shared reader of [`@beonauto/specs/document`](../../packages/specs/README.md#reading-function-documents) and gives a `RecallFunctionDefinitionDocument`: an optional `description`, the `language`, `jq`, the compiled `input.schema` and `output.schema` when the document has them, the `answer` with the line it is on, and the `details` the host folds the view by: the fold and the line it starts on, the answer's text, the filters, `initial` and the view's schema. The front matter's keys are `description`, `language`, `source.events`, `view.initial`, `view.schema`, `input.schema`, `output.schema` and `answer`; every other key, `model`, `config`, `tools`, `output.format` and `input.default` among them, is an issue at its line, and the message for empty front matter names `the language and the events it folds`.

The fold and the answer are compiled with the evaluator of [`@beonauto/workflow-engine/dsl`](../../packages/workflow-engine/README.md#programs) under the refusals of computation functions and `$ARGS` (`src/document/recall-dialects.ts`): the fold binds `$event` alone, the answer `$input` alone, and a filter's `data` expression nothing, so every other `$name` is refused with its line. A filter (`src/document/source-filters.ts`) is read with the engine's `literalFilterOf`, so its `type`, `source` and `subject` are written out and it tests no other attribute; a `data` that names a variable, or does not compile in the filter's dialect, is refused with the evaluator's own message, never the expression's text. `initial` must fit the bound on a view, 524,288 bytes as JSON, and match the view's schema; the shared reader already bounds the front matter's nesting at 72 levels.

`summarize` answers the description, the schemas and the `details`, which the registry keeps with the definition record and never answers, so the host can fold a view without this package's parser.

## A run

`makeRecallFunctionAdapter({ pool, views, mostFunctions, deadlineMs })` makes the primitive; the server gives it the computation pool and the host's `ViewsPort`. Its `mostActive` is `mostFunctions`, 32 unless the server's `RECOLLECTION_MAX_FUNCTIONS` says otherwise, counted by the registry at each save. `deadlineMs` is 10,000 unless a test gives less, and is the primitive's `longestExecutionMs`. The primitive reaches nothing outside and changes nothing there. An execution (`src/run/recall-run.ts`):

1. refuses an input nested deeper than 512 levels, and one its input schema refuses, as `invalid_input` with the schema's pointers;
2. reads the view through the views port and, while the view of the version saved is missing, of an older version, waiting or being built, answers `unavailable` with the kind `rebuilding`, the count folded and the lag in words; while it is stalled, `conflict` with the kind `stalled`, in fixed words with the type and time of the event and the line of the fold, never the fold's own message, the event's values or its id (`src/run/view-words.ts`);
3. without an `answer`, answers the view itself, checked against the output schema on the serving thread, since the view is at most 512 KiB; with one, asks the pool to apply it to the view with the input as `$input`, under 16,000,000 units of work, in `exactly one` mode, with an output of at most `mostOutputBytes`, 1 MiB less 2,048 bytes for the record, and, for a definition with an output schema, the checked worker of `@beonauto/specs/json-schema`, which checks the output there;
4. turns the outcome into the run's ending as a computation function's run does (`src/run/answer-endings.ts`), and records `{ language, work, duration_ms, input_bytes, output_bytes, view: { version, checkpoint, checkpoint_at, folded, last_event } }`, so a caller who does not see an event can tell how far the view had read.

A run never waits for the projector. `get_spec` of a recall function adds its `standing` (`src/primitive/recall-standing.ts`): the view's state, version, checkpoint, count folded, last event, lag and the time of the brain's newest record, and for a stalled view the event's id, type and time, the kind of stall, the fold's raw error and its line; a retired function has none.

The host's projector folds pages of events in the pool with `recallFolding`, whose worker is that checked worker too, so each view is checked against its schema where it was folded, and a view or an answer it refuses is worded with `issuesDetail` of `@beonauto/specs/json-schema`, the one wording of the issues a computation output gets.

## Bounds

`recallBounds` holds them: 8 filters, 16,000,000 units of work for a fold and for an answer, a fold deadline and a run deadline of 10,000 ms, a heap of 256 MiB, a view of 524,288 bytes, a value depth of 512 and a depth of evaluation of 10,000, twenty overtimes before a fold that runs past its deadline stalls, a page budget of 2,000 ms, ten pages a brain a pass, and the defaults of the settings, 32 functions a brain, four rebuilds a brain and four brains at once. Each bound has a test that reaches it: here; in [`@beonauto/workflow-host`](../../packages/workflow-host/README.md#testing) for the projector's, the pages of a pass, the brains at once, the half of the pool the projector holds, the tries before a stall and the page budget, each with a smaller value of its setting so that the test fails when the bound is removed; and in the server's `src/recall` over HTTP and MCP.

The hosted runtime does not offer recall functions until its adapter bounds the time and the memory of a fold and an answer, as for computation functions.

## Testing

`@beonauto/recollection/testing` exports `campaignReviews`, the example document, `recallDocument(fold, frontMatter)`, a document of a fold over every successful run, and `reviewBrief`, a reasoning function whose runs the example folds. The tests of this package run real workers through a fake views port (`src/testing/kept-views.ts`), and the engine's `scriptedPool` for the outcomes a real worker gives only rarely.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/document` holds the document: its type, the front matter's keys, the dialects, the filters and parsing. `src/run` holds a run and the folding settings: the bounds, the input's checks, the answer, its endings and the words of a view not ready. `src/primitive` holds the primitive, its parsing and summary, its standing and its description for agents. `src/testing` holds the example and what the tests share.
