# @beonauto/brains

The brain operations of auto-brain: create, list, read, update and retire the brains of an org. They are defined on the application layer, [`@beonauto/operations`](../operations).

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

The limits of `name` and `description` hold for the text as sent, so the JSON Schema of an input carries them as `minLength` and `maxLength`. The stored text is trimmed, and a name that trims to nothing is refused.

## The operations

All five are org operations, so their routes are relative to the org. `brainOperations` lists them for a catalog.

| Operation      | Kind    | Route                         | Input                                                   | Answer                       | Refusals of the handler |
| -------------- | ------- | ----------------------------- | ------------------------------------------------------- | ---------------------------- | ----------------------- |
| `create_brain` | command | `POST /brains`                | `brain` (the id), `name`, `description` (default empty) | the brain, `201`             | `conflict`              |
| `list_brains`  | query   | `GET /brains`                 | `include_retired` (default `false`)                     | `{ brains }`, sorted by id   | none                    |
| `get_brain`    | query   | `GET /brains/{brain}`         | `brain`                                                 | the brain, active or retired | `not_found`             |
| `update_brain` | command | `PUT /brains/{brain}`         | `brain`, `name`, `description`, all required            | the brain                    | `not_found`, `conflict` |
| `retire_brain` | command | `POST /brains/{brain}/retire` | `brain`                                                 | the brain                    | `not_found`, `conflict` |

- `create_brain` meets `conflict` when an active or a retired brain holds the id.
- `update_brain` meets `conflict` when the brain is retired. An update that changes nothing succeeds and records nothing.
- Retiring is permanent: there is no restore. Retiring a retired brain succeeds and records nothing.
- Every command also meets `conflict` when the org's brains changed while it decided.
- `list_brains` lists only the brains the caller may reach, and leaves out the retired ones unless `include_retired` is true. `include_retired` decodes from a JSON boolean and from the strings `true` and `false` of a query string.

Before a handler runs, the dispatcher refuses with `forbidden` a caller of another org, a caller without `org:read` for the queries or `org:write` for the commands, and a caller that may not reach the brain named by the `brain` field of `create_brain`, `get_brain`, `update_brain` or `retire_brain`. So a caller limited to a list of brains creates, reads, updates and retires only those. The dispatcher refuses with `invalid_input` input that breaks the schema, including fields the operation does not know.

## Storage

The brains of an org live in one stream, named `brains` relative to the org. Its facts carry a `type`, the brain id, who recorded it (`by`) and when (`at`):

- `brain_created`, with the name and the description
- `brain_updated`, with only the fields that changed
- `brain_retired`

There is no read model: each call folds the stream. A pure decider holds the rules; the handlers pass it who and when in the command.

## The directory

`ledgerBrainDirectory` is a `Layer` that provides the `BrainDirectory` of `@beonauto/operations` from a `Ledger`. A brain exists while the `brains` stream of its org holds it as active, so a brain-scoped operation refuses a retired brain as `not_found`. The directory names the stream with `streamPrefixOfOrg`, the prefix the org-bound ports put before `brains`, so it reads the very stream the operations write.

## Source

`src/index.ts` is the only entry point. `src/roster` holds a brain, the facts and commands of the `brains` stream, its rules and its name. `src/operations` holds the five operations and how they read and record the roster. `src/directory` holds the brain directory. `src/testing` holds what the tests share. `operations` and `directory` depend on `roster`, never on each other.
