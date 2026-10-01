# @beonauto/api

The API of auto-brain: the handler the server answers every request with. It serves each operation of a catalog twice, once as an HTTP route and once as an MCP tool, and both run the operation through the same dispatcher, so a call means the same thing whichever way it arrives. The operations themselves are defined on the application layer, [`@beonauto/operations`](../operations).

## Every request

Each request passes through the same chain before it reaches an operation, in this order:

1. It gets an `x-request-id` and the security headers.
2. An `Origin` that is not in `ALLOWED_ORIGINS` gets `403` `origin_not_allowed`; in local mode, a `Host` that is not a localhost name gets `403` too.
3. A CORS preflight from an allowed origin gets `204`.
4. The caller authenticates with `Authorization: Bearer <key>`, or as the local developer in local mode; a request without a valid key gets `401`.

A path with no route gets `404` `not_found`, and a method the path does not serve gets `405` `method_not_allowed` with an `Allow` header. Every one of these errors is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document.

## Over HTTP

`operationRoutes` registers one route per operation. An org operation's route is relative to `/v1/orgs/{org}`, a brain operation's to `/v1/orgs/{org}/brains/{brain}`; literal segments win over parameters wherever two routes could match the same path.

- **Input.** The operation's input is one object assembled from the path parameters, the query string of a `GET`, and the JSON body of a `POST` or `PUT`. A field may come from only one place; giving it twice is `400` `bad_request`, and so is a query string on a command. Query values arrive as strings and decode with the `strings` encoding; a body decodes with the `json` encoding.
- **Body.** A body must be a JSON object sent as `application/json` in UTF-8, with no `Content-Encoding` other than `identity`, and no larger than 1 MiB. Otherwise it is `413` `content_too_large`, `415` `unsupported_media_type` or `400` `bad_request`.
- **Answer.** A success is the operation's output as JSON with the operation's success status (`200`, or `201` where the operation says so) and `Cache-Control: no-store`.

An outcome that is not a success becomes a problem document:

| Outcome   | Status and reason                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| rejected  | the status of the rejection's reason, such as `403` `forbidden`, `404` `not_found`, `409` `conflict` or `422` `invalid_input` with an `errors` list |
| failed    | `500` `internal`, saying nothing about the cause; its `instance` is `urn:uuid:<id>`, the incident id under which the server logs the error          |
| cancelled | `499` `client_closed_request` when the client went away, `503` `unavailable` when the server is stopping                                            |

A `403` `forbidden` also carries `WWW-Authenticate: Bearer error="insufficient_scope"`.

## Over MCP

`mcpRoutes` serves the same catalog to agents over the [Model Context Protocol](https://modelcontextprotocol.io), with the official SDK, `@modelcontextprotocol/server`, pinned exactly. It is stateless: each request builds a fresh MCP server for its caller and keeps no session. It serves the current protocol revision, `2026-07-28`, and the previous one, `2025-11-25`, so clients of the SDK's 1.x line connect too; a client that asks for an older revision is offered `2025-11-25`. MCP sits outside `/v1` because the protocol versions itself.

| Endpoint                              | Tools                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `POST /orgs/{org}/mcp`                | the org operations, such as `create_brain`                                  |
| `POST /orgs/{org}/brains/{brain}/mcp` | the brain operations, such as the spec operations of the brain's primitives |

Both endpoints sit behind the same chain as every other path. Before the SDK runs, a caller of another org gets `403` `forbidden`, and so does a caller that may not access the brain of a brain endpoint, as problem documents. `GET`, `DELETE` and every other method get `405` with `Allow: POST`; the SDK would answer them with a JSON-RPC error and no `Allow` header, so they never reach it. A brain endpoint does not check that its brain exists: each tool call does, and answers a missing brain with `not_found`.

**Tools.** Each operation is one tool: its `name`, `title` and `description` are the operation's, and its `inputSchema` and `outputSchema` are the operation's JSON Schemas (draft 2020-12), each self-contained with an object at the root and its definitions under `$defs`. The annotations derive from the operation:

| Annotation        | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| `readOnlyHint`    | `true` for a query, `false` for a command                 |
| `destructiveHint` | `false`                                                   |
| `idempotentHint`  | `true` when the operation's HTTP method is `GET` or `PUT` |
| `openWorldHint`   | `false`                                                   |

**Calls.** The org, and the brain of a brain endpoint, come from the URL; the arguments are the whole input, decoded with the `json` encoding. A call goes through the same dispatcher and the same `settle` as an HTTP request, with the caller in the URL's org.

| Outcome                     | Tool result                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| succeeded                   | `structuredContent` is the output, and the one text content is the same output as JSON                                    |
| rejected, failed, cancelled | `isError: true`, and the one text content is the problem document HTTP would answer with, as JSON; no `structuredContent` |

So invalid arguments are a tool result with `isError` and an `invalid_input` problem pointing at each field, as the protocol asks, and an agent can correct them. A tool the endpoint does not list is a JSON-RPC error, `-32602`, from the SDK. A call still running when the server stops gets a `503` `unavailable` problem.

**Server identity.** `serverInfo` carries the name and version the server passes in, which are the product name and the release version. The instructions are `orgEndpointInstructions` and `brainEndpointInstructions`:

> This MCP endpoint serves one org of auto-brain, the runtime for business brains. Its tools are the operations on the org as a whole, such as creating, listing, reading, updating and retiring its brains. Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns. A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.

> This MCP endpoint serves one brain of an org in auto-brain, the runtime for business brains. Its tools are the operations inside that brain, such as defining, versioning, retiring and executing the specs of its primitives; it lists no tools when the server offers no primitive. Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns. A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.

**Which errors look how.** An MCP endpoint answers in three shapes:

| Shape                              | When                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| problem document                   | before the SDK runs: `401`, `403` (origin, org or brain), `400` for a malformed `Authorization` header, `405`                                                                                                                                                                                                                                                                                                               |
| JSON-RPC error with an HTTP status | the SDK rejects the request: `406` when `Accept` lacks `application/json` and `text/event-stream`, `413` for a body over 1 MiB, `415` when `Content-Type` is not `application/json`, `400` with `-32700` for a body that is not JSON or not JSON-RPC, `400` for a request made under a revision the endpoint does not serve or whose MCP headers disagree with its body, and `-32602` for a tool the endpoint does not list |
| tool result with `isError`         | the operation did not succeed: a rejection, a failure or a cancellation, with the problem document as text                                                                                                                                                                                                                                                                                                                  |

The SDK reports the errors it answers with JSON-RPC to `reportError`, which the server logs as a warning on stderr. Nothing the SDK does writes to stdout.

## Lifecycle

A `RegisterRoutes` function receives `routes.add`, to add a route, and `routes.onClose`, to add something to close when the API closes. `mcpRoutes` registers the closing of both MCP handlers, which ends the calls they still serve. `ApiHandler.close` closes everything registered. The server calls it as it shuts down, after it has disposed of its runtime, so a call still running has already been answered as cancelled.

## Exports

`src/index.ts` is the entry point: `createApiHandler`, `makeAppRuntime`, `operationRoutes`, `mcpRoutes`, the instructions, and their types. `@beonauto/api/testing` exports what the server's tests share: real MCP clients of the current SDK, on either revision, and of the SDK's 1.x line, and the `wait_forever` operation, which never finishes on its own.

## Source

`src/middleware` holds the chain every request passes, `src/authentication` the bearer authentication, and `src/problem` problem documents and how outcomes become them. `src/operations` holds the HTTP routes: the route table, how input is assembled and how an outcome becomes a response. `src/mcp` holds the MCP endpoints: the tools, their schemas, how a result is built and how the caller reaches the SDK's server. `src/testing` holds what the tests share.
