# HTTP API

The runtime exposes the same operations through HTTP and [MCP](mcp.md). Product terminology uses functions, workflows and runs. The API keeps `spec`, `inference`, `orchestration` and `execution` for compatibility.

Use an API key as `Authorization: Bearer <key>`, except in loopback-only local mode. See [Authentication and security](../self-host/security.md). For executable examples, follow the [HTTP walkthrough](http-tutorial.md).

## Requests and responses

Org routes begin at `/v1/orgs/{org}`. Brain routes begin at `/v1/orgs/{org}/brains/{brain}`. A key belongs to one org, with permissions and an allowed set of brains.

Send command bodies as UTF-8 JSON objects with `Content-Type: application/json`. Request bodies may be at most 1 MiB; compressed bodies are not accepted. Query parameters belong to GET requests. A field cannot be supplied in more than one location.

Successful responses contain the operation output as JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200. Unknown routes return 404. Unsupported methods return 405 with an `Allow` header.

## Brains

These routes are relative to `/v1/orgs/{org}`:

| Operation      | Method and route              | Input                                   |
| -------------- | ----------------------------- | --------------------------------------- |
| `create_brain` | `POST /brains`                | `brain`, `name`, optional `description` |
| `list_brains`  | `GET /brains`                 | Optional `include_retired`              |
| `get_brain`    | `GET /brains/{brain}`         | Brain id in path                        |
| `update_brain` | `PUT /brains/{brain}`         | `name` and `description`                |
| `retire_brain` | `POST /brains/{brain}/retire` | Brain id in path                        |

Brain ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Ids are never reused. Retirement is permanent; it is not deletion or an archive that can be restored.

Read operations need `org:read`, and writes need `org:write`. The key's brain restrictions apply to named-brain operations. Lists include only accessible brains, with retired brains excluded unless requested.

## Definitions

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation              | Method and route                         | Input                                          |
| ---------------------- | ---------------------------------------- | ---------------------------------------------- |
| `create_spec`          | `POST /specs/{primitive}`                | `name`, `source`                               |
| `list_specs`           | `GET /specs/{primitive}`                 | Optional `include_retired`                     |
| `get_spec`             | `GET /specs/{primitive}/{name}`          | Path parameters                                |
| `update_spec`          | `PUT /specs/{primitive}/{name}`          | `source`                                       |
| `retire_spec`          | `POST /specs/{primitive}/{name}/retire`  | Path parameters                                |
| `execute_spec`         | `POST /specs/{primitive}/{name}/execute` | Optional `input`, optional UUID `execution_id` |
| `get_execution`        | `GET /executions/{execution_id}`         | Execution id in path                           |
| `send_execution_event` | `POST /executions/{execution_id}/events` | `event`, when workflows are enabled            |

Supported primitive identifiers are `inference` and, with Temporal configured, `orchestration`. A reason function uses the [Markdown prompt format](reasoning-format.md). A workflow uses the [YAML workflow format](workflow-format.md).

Names contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its primitive and brain and cannot be reused after retirement.

Changing a document creates a new version. Updating it with identical source succeeds without recording a change. Execution uses the active latest version. Retirement is permanent: retired definitions can be read but cannot be edited or run.

Queries need `brain:read`; commands, including execution and events, need `brain:write`. An API key with read access alone cannot run a function.

## Runs and results

A run includes `execution_id`, `primitive`, `name`, `spec_version`, `status`, timestamps and caller identity. It includes an `output` when successful or a rejection when rejected. Reading a run with `get_execution` also returns its detailed `record`.

Reason functions normally complete within the execute request. Workflows return `started` while work continues. Poll `get_execution` until the status becomes `succeeded`, `rejected` or `failed`. An approval event should be sent to the waiting run; it does not create another run.

Inputs may be at most 256 KiB as encoded JSON. Output and record together may be at most 1 MiB. The runtime applies these limits independently of the request-body limit.

## Idempotency and retries

Supply `execution_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`.

Once a run succeeds or rejects invalid input, it has a final result. Calling again with the same id and input returns that recorded result. A waiting workflow also returns its existing run without restarting it.

A run without a final result may be attempted again after an interruption, an unavailable dependency or another recoverable failure. A retry can use the latest definition version, which the new attempt records. Side effects must tolerate at-least-once execution; one recorded final result does not guarantee that an external action ran only once.

## Errors

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`. Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers.

| Status | Common reason                       |
| ------ | ----------------------------------- |
| 400    | `bad_request`                       |
| 401    | Missing or invalid credentials      |
| 403    | `forbidden` or `origin_not_allowed` |
| 404    | `not_found`                         |
| 409    | `conflict`                          |
| 422    | `invalid_input`                     |
| 500    | `internal`                          |
| 503    | `unavailable`                       |

A 500 response contains an incident reference, not the underlying exception. Its `instance` and the `x-request-id` response header identify the corresponding server log entry. Malformed HTTP rejected by Node's parser can return a bare status without a problem document.

`/health` reports server liveness without authentication. It does not report whether Temporal or the workflow worker is ready. See [Troubleshooting](../self-host/troubleshooting.md).
