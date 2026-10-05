# HTTP API

The HTTP API provides brain management, reason-function and workflow definitions, recorded runs, and events for waiting workflows. Requests use the API base URL and credentials supplied for the workspace.

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The API calls definitions `specs` and runs `executions`. A reason function uses the primitive identifier `inference` and a workflow uses `orchestration`; keep these names in requests.

## Requests and access

Send credentials as `Authorization: Bearer <key>` and command bodies as UTF-8 JSON with `Content-Type: application/json`. Keep credentials out of prompts and source documents.

Org routes begin at `/v1/orgs/{org}`. Brain routes begin at `/v1/orgs/{org}/brains/{brain}`. Each API key belongs to one org and has permissions for a set of brains. Reading definitions and runs requires `brain:read`; creating, changing or running a function or workflow, and sending an event, require `brain:write`.

Request bodies may be at most 1 MiB; compressed bodies are not accepted. Query parameters belong to GET requests. A field cannot be supplied in more than one location.

## Brains

These routes are relative to `/v1/orgs/{org}`:

| Operation      | Method and route              | Input                                   |
| -------------- | ----------------------------- | --------------------------------------- |
| `create_brain` | `POST /brains`                | `brain`, `name`, optional `description` |
| `list_brains`  | `GET /brains`                 | Optional `include_retired`              |
| `get_brain`    | `GET /brains/{brain}`         | Brain id in path                        |
| `update_brain` | `PUT /brains/{brain}`         | `name` and `description`                |
| `retire_brain` | `POST /brains/{brain}/retire` | Brain id in path                        |

Brain ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Read operations need `org:read`, and writes need `org:write`. Lists include accessible brains, with retired brains excluded unless requested.

Retirement is permanent. Brain ids cannot be reused, and a retired brain cannot be restored.

## Models

`GET /v1/orgs/{org}/models` lists the models the server offers. It requires `org:read` and accepts an optional `provider` query parameter. A provider prefix contains 1 to 32 lowercase letters, digits or hyphens, starting with a letter.

The JSON result contains `object: "list"`, `data`, `catalog_status` and `listed_at`. Entries are sorted by `id`, with each id appearing once. The [MCP model reference](mcp.md#model-information) describes the entry fields, aliases, wildcard patterns and incomplete results. The same output is returned over both interfaces.

## Reason functions

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation       | Method and route                       | Input                                          |
| --------------- | -------------------------------------- | ---------------------------------------------- |
| `create_spec`   | `POST /specs/inference`                | `name`, `source`                               |
| `list_specs`    | `GET /specs/inference`                 | Optional `include_retired`                     |
| `get_spec`      | `GET /specs/inference/{name}`          | Name in path                                   |
| `update_spec`   | `PUT /specs/inference/{name}`          | `source`                                       |
| `retire_spec`   | `POST /specs/inference/{name}/retire`  | Name in path                                   |
| `execute_spec`  | `POST /specs/inference/{name}/execute` | Optional `input`, optional UUID `execution_id` |
| `get_execution` | `GET /executions/{execution_id}`       | Execution id in path                           |

The `source` is a [reason function document](reasoning-format.md). Names follow the same 3 to 48 character rule as brain ids. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its primitive and brain and cannot be reused after retirement.

Changing a document creates a version. Updating it with identical source records no change. A run uses the active latest version. Retired definitions can be read but cannot be edited or run.

## Workflows

These routes are relative to `/v1/orgs/{org}/brains/{brain}`. They are served when the runtime offers workflows; otherwise `/specs/orchestration` returns `not_found` with the detail `There is no primitive orchestration`, and the events route does not exist.

| Operation              | Method and route                           | Input                                                                  |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `create_spec`          | `POST /specs/orchestration`                | `name`, `source`                                                       |
| `list_specs`           | `GET /specs/orchestration`                 | Optional `include_retired`                                             |
| `get_spec`             | `GET /specs/orchestration/{name}`          | Name in path                                                           |
| `update_spec`          | `PUT /specs/orchestration/{name}`          | `source`                                                               |
| `retire_spec`          | `POST /specs/orchestration/{name}/retire`  | Name in path                                                           |
| `execute_spec`         | `POST /specs/orchestration/{name}/execute` | Optional `input`, optional UUID `execution_id`                         |
| `get_execution`        | `GET /executions/{execution_id}`           | Execution id in path                                                   |
| `send_execution_event` | `POST /executions/{execution_id}/events`   | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

The `source` is a [workflow document](workflow-format.md). Names, document size, versions and retirement follow the rules for reason functions above. A saved workflow has the `media_type` `application/yaml`, and its `description`, `input_schema` and `output_schema` come from the document.

`execute_spec` returns 200 as soon as the run begins, with its `execution_id` and `status: started`. Read the run with `get_execution` until its status is `succeeded`, `rejected` or `failed`. When the workflow engine cannot start the run, `execute_spec` returns `unavailable`; try again later.

`send_execution_event` delivers an event to a run that is still `started`. It returns the `execution_id` and the delivered `event`, with an `id`, made by the runtime when you leave it out, and the `time` it was sent. An event may take at most 256 KiB as JSON; its `type` and `id` at most 256 characters, and its `source` and `subject` at most 1,024. A run takes an event with a given `id` once, so a request can be retried with the same id. The operation returns `not_found` when the brain has no running workflow with that execution id, including one that has ended, and `unavailable` when the workflow engine cannot be reached; try again later.

## Runs and results

A run records its `execution_id`, `primitive`, `name`, `spec_version`, `status`, timestamps and caller identity. Successful runs include `output`; rejected runs include a rejection. `get_execution` also returns the detailed `record`.

Reason functions normally complete within the execute request. A workflow run answers `started` and continues after the request; while it is in progress, its `record` holds the `workflow_id` and `run_id` of the running workflow. [Workflows and runs](../concepts/workflows.md) explains how a run waits and ends. Inputs may be at most 256 KiB as encoded JSON. Output and record together may be at most 1 MiB. These limits apply independently of the request-body limit.

Supply `execution_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`. Once a run succeeds or rejects invalid input, another request with the same id and input returns the recorded final result. A request with the id of a workflow run still in progress returns that run as it stands, without starting another.

A run without a final result may be attempted again after an interruption or recoverable failure. A retry can use the latest definition version, which the new attempt records. Do not assume that an external effect happened only once because the runtime records one final result.

## Responses and errors

Successful responses contain JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200.

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`. Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict`                                 |
| 422    | `invalid_input`                            |
| 500    | `internal`                                 |
| 503    | `unavailable`                              |

A 500 response contains an incident reference. Its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. Malformed HTTP can return a bare status before the API handles it.

A function naming a model outside the deployment's allow list returns `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before calling the provider. A missing provider can return the same kind with `because: "provider_not_configured"`. Use `list_models` to inspect the offered references.
