# @beonauto/brains

The brain operations of auto-brain: create, list, read, update and retire the brains of an org, and follow what happened in one brain. They are defined on the application layer, [`@beonauto/operations`](../operations).

## A brain

A brain belongs to one org.

| Field         | What it holds                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Chosen by its creator: 3 to 48 lowercase letters, digits and hyphens, starting with a letter. Unique in the org, never reused |
| `name`        | 1 to 100 characters, not all whitespace, stored trimmed                                                                       |
| `description` | 0 to 2000 characters, stored trimmed                                                                                          |
| `status`      | `active` or `retired`                                                                                                         |
| `created_at`  | When it was created                                                                                                           |
| `created_by`  | The id of the caller who created it                                                                                           |
| `updated_at`  | When it last changed                                                                                                          |
| `retired_at`  | When it was retired, on a retired brain only                                                                                  |

Times are ISO 8601 UTC strings read from Effect's `Clock`. `BrainSchema` is the schema of a brain.

The limits of `name` and `description` hold for the text as sent, so the JSON Schema of an input carries them as `minLength` and `maxLength`. The stored text is trimmed, and a name that trims to nothing is rejected.

## The operations

All five are org operations, so their routes are relative to the org. `brainOperations` lists them for a catalog.

| Operation      | Kind    | Route                         | Input                                                   | Answer                       | Rejections of the handler |
| -------------- | ------- | ----------------------------- | ------------------------------------------------------- | ---------------------------- | ------------------------- |
| `create_brain` | command | `POST /brains`                | `brain` (the id), `name`, `description` (default empty) | the brain, `201`             | `conflict`                |
| `list_brains`  | query   | `GET /brains`                 | `include_retired` (default `false`)                     | `{ brains }`, sorted by id   | none                      |
| `get_brain`    | query   | `GET /brains/{brain}`         | `brain`                                                 | the brain, active or retired | `not_found`               |
| `update_brain` | command | `PUT /brains/{brain}`         | `brain`, `name`, `description`, all required            | the brain                    | `not_found`, `conflict`   |
| `retire_brain` | command | `POST /brains/{brain}/retire` | `brain`                                                 | the brain                    | `not_found`, `conflict`   |

- `create_brain` meets `conflict` when an active or a retired brain holds the id.
- `update_brain` meets `conflict` when the brain is retired. An update that changes nothing succeeds and records nothing.
- Retiring is permanent: there is no restore. Retiring a retired brain succeeds and records nothing.
- Every command also meets `conflict` when the org's brains changed while it decided.
- `list_brains` lists only the brains the caller may access, and leaves out the retired ones unless `include_retired` is true. `include_retired` decodes from a JSON boolean and from the strings `true` and `false` of a query string.

Before a handler runs, the dispatcher rejects with `forbidden` a caller of another org, a caller without `org:read` for the queries or `org:write` for the commands, though `list_brains` is permitted by `brain:read` as well, since it answers only the brains its caller may access, and a caller that may not access the brain named by the `brain` field of `create_brain`, `get_brain`, `update_brain` or `retire_brain`. So a caller limited to a list of brains creates, reads, updates and retires only those. The dispatcher rejects with `invalid_input` input that breaks the schema, including fields the operation does not know.

## What happened in a brain

`defineListBrainEvents(presenters)` makes `list_brain_events`, a brain query at `GET /events` relative to the brain, under `brain:read`. It takes the presenters as a parameter, the way `makeSpecOperations` takes primitives, so this package depends on `@beonauto/operations` alone; the server passes the presenters of every package that owns a stream kind, today `makeSpecPresenters` of `@beonauto/specs`, which presents the specs, the executions and the events published to the brain with `publish_event`. At least one presenter must show at least one type of event.

| Input          | What it does                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `order`        | `desc`, newest first, when left out; `asc`, oldest first                                                                              |
| `limit`        | 1 to 100, 20 when left out: the most events a page answers with                                                                       |
| `cursor`       | The `next_cursor` of the page before, or the `cursor` of an event, to read on after it                                                |
| `since`        | A time in ISO 8601: what the brain recorded from then on, by the time it was recorded, in either order                                |
| `type`         | One public type of event, which the published JSON Schema lists; it is translated to the stored types its presenters present under it |
| `execution_id` | The id of a run no other run started: only what that run and the runs it started recorded, the messages whose correlation is that run |

It reads the brain's whole partition of the ledger (`BrainReader.readRecorded({ kind: 'everything' }, page)`), or with `execution_id` the messages correlated to that run (`{ kind: 'correlated', correlation }`), and answers `{ events, has_more, next_cursor }`, each event a `PublicEvent`, `{ id, cursor, causation_id, at, type, summary, data }`. A run that another run started belongs to the tree of the run at its top, so its own id answers nothing. `limit` counts the events a page answers with, the step events of a workflow's records included, through `eventsPageOf` of `@beonauto/operations`, so a page may end inside a record. A record of a stream kind no presenter presents, or of a type its presenter hides, is left out, and with `type` only the events presented under that name are kept, though another kind stores a type of the same name. A page looks at `limit` records, or with `type` at up to 1,000, and ends at 4 MiB of stored data. So a page may hold fewer events than `limit`, or none, while `has_more` is true; `next_cursor` is null only when nothing remains. A cursor that does not decode, or that another brain gave, is `invalid_input` at `/cursor`, and a `type` no presenter shows `invalid_input` at `/type`.

The feed cannot show the brain's own creation, update and retirement: they are recorded in the org's `brains` stream, outside the brain's partition, and `get_brain` reads them. A retired brain stays readable, since the dispatcher runs every query on it.

## Storage

The full set of an org's brains is the org's brain registry. It lives in one stream, named `brains` relative to the org. Its facts carry a `type`, the brain id, who recorded it (`by`) and when (`at`):

- `brain_created`, with the name and the description
- `brain_updated`, with only the fields that changed
- `brain_retired`

There is no read model: each call folds the stream. A pure decider holds the rules; the handlers pass it who and when in the command.

## The brain registry port

`ledgerBrainRegistry` is a `Layer` that provides the `BrainRegistry` port of `@beonauto/operations` from a `Ledger`. It answers the status of a brain as the org's brain registry holds it: `active` from its creation, `retired` from its retirement, and `unknown` for an id the org never created. It names the stream with `streamPrefixOfOrg`, the prefix the org-bound ports put before `brains`, so it reads the very stream the operations write.

The dispatcher applies the status to every brain-scoped operation. A retired brain stays readable: every query runs on it, so what the brain recorded survives its retirement. Every command on a retired brain is refused with `conflict`, kind `retired`, and the detail `update_brain` gives, such as `The brain gamma is retired and can no longer change`. An unknown brain is `not_found`.

## Source

`src/index.ts` is the only entry point. `src/registry` holds the org's brain registry: a brain, the facts and commands of the `brains` stream, the registry's decider and its rules, the stream's name, and `ledgerBrainRegistry`. `src/operations` holds the five operations and how they load the registry and record in it. `src/feed` holds `list_brain_events`. `src/testing` holds what the tests share. `operations` depends on `registry`, never the other way round.
