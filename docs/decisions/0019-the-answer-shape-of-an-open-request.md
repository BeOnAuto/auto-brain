# 0019 — The answer shape of an open request: the listing shows the schema each request recorded

**Status:** accepted (2026-10-08); built 2026-10-08, with the amendments at the end

## Context

Verified against `origin/main` at f4a7d7f6. Interaction functions (0010) let a brain ask a person or a system and take the answer later; speaking to agents (0016) made the answer a tool call an agent makes when the person approves, rejects or revises in a conversation. Two reviews of that path found that an agent cannot answer a request from the listing alone.

- `list_interactions` shows each open request with `execution_id`, `function`, `version`, `to`, `channel`, `message`, `takes_answer`, `requested_at`, `expires_at`, `attempts` and `standing` (`primitives/interaction/src/requests/list-interactions.ts:20-35`), and no shape for the answer.
- `answer_interaction` checks an answer against the schema the request recorded, the `answer_schema` of the run's deferral (`answer-interaction.ts:49,63-68`), not against the function as it stands. Its description sends the agent to "its function's output_schema" (`answer-interaction.ts:44`), and the interaction guide says `get_spec` shows it as `output_schema` (`docs/reference/interaction-format.md:83`). `get_spec` shows the latest version: a request asked by version 1 and still open after version 2 changed the answer's shape is checked against version 1's. So the agent makes a second call to learn the shape, and when the function has changed since, its first answer is refused as `invalid_input` and the person sees an answer fail.
- The request already carries its schema. The deferral's record is `{ channel, to, message, answer_schema, expires_at }`, `answer_schema` left out of a notification (`primitives/interaction/src/run/request-record.ts:3-9`, `interaction-run.ts:25-31`). The webhook's `interaction_requested` carries it as `data.answer_schema` (`docs/reference/interaction-format.md:67`), and an MCP channel's arguments as `answer_schema`, `null` for a notification (`src/run/request-reach.ts:95`, `src/delivery/mcp-delivery.ts:44`).
- The listing reads the open-requests projection, version 1, one indexed read for a page (`list-interactions.ts:101-107`). A projection's columns are text, whole numbers or booleans (`packages/operations/src/projections/run-projection.ts:9`), its table is `<name>_<version>`, and a ledger that opens with a version whose table it does not find creates it, fills it by replaying every run stream and drops the tables of earlier versions, in one transaction (`packages/ledger/README.md`, The projections of runs; `packages/ledger/src/projections/projection-fill.ts:99-123`).
- What bounds a schema. A JSON Schema in a definition is at most 65,536 bytes as JSON and 64 levels deep, checked when the document is saved (`packages/specs/src/document/json-schema.ts:15-19,54-64`, through `compileJsonSchema` in `primitives/interaction/src/document/document-parsing.ts:40-48`), in a document of at most 65,536 bytes (`packages/specs/src/operations/spec-fields.ts:7`). A page of the listing holds 1 to 100 requests, 20 by default (`packages/operations/src/reading/page-bounds.ts:1`, `paging-fields.ts:6`), each message at most 8 KiB (0010 §6).

## Decision

### 1. Each listed request carries `answer_schema`

`list_interactions` shows, for each open request, `answer_schema`: the JSON Schema the request recorded when it was asked, the one `answer_interaction` checks an answer against, and `null` for a notification. The name is the one the request already has in the deferral's record, the webhook's event and an MCP channel's arguments, and `null` for a notification follows the MCP arguments, so what the brain sends and what it lists use one word. It is not called `output_schema`: that is a definition's field, as `get_spec` shows it for the latest version, and the two differ exactly when a function changed while a request was open. `takes_answer` stays, the yes-or-no a reader checks without reading a schema; it is true exactly when `answer_schema` is not `null`.

### 2. It lives in the open-requests projection, version 2

The projection gains one nullable text column, `answer_schema`, holding the recorded schema as JSON text, written from the deferral's record and carried unchanged by every later fact of the run; the listing decodes it back to a JSON object, or `null`. The projection's version goes from 1 to 2, so its table becomes `open_requests_2`: a server that starts on a ledger with `open_requests_1` fills the new table by replaying the run streams and drops the old one. Since the deferral has recorded `answer_schema` since interaction functions were built, the rebuilt rows of earlier requests carry their schemas too. Nothing is live, so the fill runs once on each development store and nothing keeps the old table.

Two other places were weighed. Reading each listed run's deferral when the page is built needs no column and no version, but turns a page from one indexed read into up to 101 reads, one more for each run on the page. A fourth column kind for JSON would change both stores' dialects in the ledger for a value no read filters or orders on; text holding JSON, decoded at the read, needs nothing new from the ledger.

### 3. Bounds

Each schema is at most 65,536 bytes as JSON and 64 levels deep, the bound it met when its function was saved; the column holds that same JSON text, so the row adds at most 64 KiB. A page of 100 requests may carry 100 schemas, at most 6,553,600 bytes, 6.25 MiB, beside at most 800 KiB of messages; over MCP the result carries the output twice, as `structuredContent` and as its JSON text, so at most about 14 MiB. The schemas of real functions are small: the approval of the interaction reference takes 151 bytes as JSON and the draft approval of the agents' episode 145, so a default page of 20 carries about 3 KB more. No byte budget is added to the page: its worst case is already bounded by the page's limit and the schema's bound; `list_specs` already answers the input and output schemas of every definition of a type at once (`packages/specs/src/operations/list-specs.ts:29-35`, `src/registry/spec.ts:18-23`); and a caller that meets large schemas asks for a smaller `limit`. Should brains come to hold such schemas, the 4 MiB budget the pages of runs and events keep (`packages/operations/src/reading/page-bounds.ts:3`) can bound this page as well.

### 4. What agents read

The description of `list_interactions` says each request carries its `answer_schema`, the shape `answer_interaction` checks, as recorded when it was asked, which `get_spec` may no longer show, and `null` for a notification; the field's own description says the same. The description of `answer_interaction` says `answer` takes the shape of the request's `answer_schema`, which `list_interactions` shows, in place of "its function's output_schema". The answering section of the interaction guide, which the server serves as `interaction-function`, says the same. Each text stays within the bounds of 0016 §8: a tool's description under 800 characters in three to eight sentences and an argument's under 300, which the server enforces at start (`packages/api/src/tools/tool-definition.ts:37-46`), and the new field's under 300 as well, which a test holds, since the server checks the descriptions of arguments and not of output fields.

### 5. What this record does not decide

A byte budget for the page (§3). Removing `takes_answer`. Showing the schema of a request that has ended, which the listing does not show at all. The instructions, which say to answer "in the shape its function's answer takes" and are at 1,948 of their 2,000 characters on `/mcp` (0016, Amendments): the tools they name now show that shape.

## Consequences

- An agent answers a request from `list_interactions` alone, in the shape `answer_interaction` will check, with no call to `get_spec` and no refused first guess after a function has changed.
- The listing, the webhook's event and an MCP channel's arguments name the request's schema the same way.
- The row of each request holds a copy of its schema, so each append that changes the row, the deferral, at most five attempts started and five ended, and the ending, reads and writes it too, and the host's loop reads it with each due row, at most 256 rows in a tick (0010 §6): about 40 KB a tick for schemas of 150 bytes, and at most 16 MiB at the bound.
- The first start of this version on a store fills `open_requests_2` from the run streams, in the same transaction and under the same lock as every fill (`packages/ledger/README.md`), and drops `open_requests_1`.

## Verification the build must include

- The projection: a question's deferral keeps its schema as JSON text and a notification's keeps `null`.
- In memory: a question lists its schema and a notification `null`; after `update_spec` gives the function another answer schema, the open request still lists the schema of the version that asked, an answer in the new shape is `invalid_input` and an answer in the listed shape settles the run.
- On SQLite and PostgreSQL, through the server over HTTP: a question lists its schema and a notification `null` as each append keeps them, and again after a store that version 1 left, holding `open_requests_1`, is opened by this version, which leaves `open_requests_2` alone.
- Over MCP, in the replay of the episode where a person approves a draft in a chat: the listed request carries the function's answer schema; the description of `list_interactions` names `answer_schema` within 800 characters and five sentences, the field's description is under 300 characters, and `answer_interaction` points at the listing.

## Build

One change. `@beonauto/interaction`: the column, the version, the row's schema, the listing's field and decoding, the descriptions of `list_interactions` and `answer_interaction`, and the tests beside them. `@beonauto/server`: the tests on both stores and over MCP, and the table's name where a test and the measurement of expiries write to it. The references: HTTP, MCP, the engineering HTTP page, the interaction guide's answering section and the package README.

## Amendments from the build

Built on 2026-10-08.

- **The texts, measured.** The description of `list_interactions` takes 710 of its 800 characters in five sentences, the description of `answer_schema` 171 of 300, and the description of `answer_interaction` 780 of 800, one more than before.
- **The rebuild, tested on both stores.** The store left by version 1 is made by dropping `open_requests_2` and opening the ledger with the declaration of version 1, which creates `open_requests_1` and fills it by replay as version 1 kept it; the server that then starts fills `open_requests_2` and drops `open_requests_1`. Both requests have had a failed delivery before the first server stops, so the replay goes through the delivery facts as well as the deferral.
- **A notification lists `null` only through a channel.** A notification to the inbox succeeds at once and makes no request (`interaction-run.ts`, `finishesLater`), so the `null` of §1 is seen for a notification through a webhook or an MCP channel while its delivery is pending or retried. The tests use a webhook channel whose receiver answers 503 to keep it open.
