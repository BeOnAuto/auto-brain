# @beonauto/api

The API of auto-brain: the handler the server answers every request with. It serves each operation of a catalog twice, once as an HTTP route and once as an MCP tool, and both run the operation through the same dispatcher, so a call means the same thing whichever way it arrives. The operations themselves are defined on the application layer, [`@beonauto/operations`](../operations).

## Every request

Each request passes through the same chain before it reaches an operation, in this order:

1. It gets an `x-request-id` and the security headers.
2. An `Origin` that is neither the console's, `https://console.on.auto`, nor in `ALLOWED_ORIGINS` gets `403` `origin_not_allowed`; in local mode, a `Host` that is not a localhost name gets `403` too.
3. A CORS preflight from an allowed origin gets `204`.
4. The caller authenticates with `Authorization: Bearer <key>`, or as the local developer in local mode; a request without a valid key gets `401`.

Before that chain, a browser opening `/` (a `GET` that accepts `text/html`) gets a page saying the server is running, with a button that opens the console on this server: `https://console.on.auto/?server=<this server's origin>`. The page needs no key. Any other request to `/` has no route.

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

`mcpRoutes` serves the same catalog to agents over the [Model Context Protocol](https://modelcontextprotocol.io), with the official SDK, `@modelcontextprotocol/server`, pinned exactly. It is stateless: each request builds a fresh MCP server for its caller and keeps no session. It serves the current stateless revision, `2026-07-28`, and the earlier ones the SDK supports: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An `initialize` in any of them is answered in that revision, with the same tools, results and errors in each, and a client that asks for a revision the SDK does not know is offered `2025-11-25`. So agents built on older SDKs, including the 1.x line of the official one, connect out of the box. Revisions before `2025-06-18` predate `structuredContent` and output schemas; the SDK sends them regardless, and a client of such a revision reads the same JSON from the text content. MCP sits outside `/v1` because the protocol versions itself.

| Endpoint                              | Tools                                                                         | Org and brain                                           |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /mcp`                           | every operation of the catalog: the org operations, then the brain operations | the caller's own org; a brain operation names its brain |
| `POST /orgs/{org}/mcp`                | the org operations, such as `create_brain`                                    | the org of the URL                                      |
| `POST /orgs/{org}/brains/{brain}/mcp` | the brain operations, such as the spec operations of the brain's primitives   | the org and the brain of the URL                        |

`/mcp` is the one an agent connects to by default: on one connection it can create a brain and then work in it. Its org is `org` of the authenticated principal: the org of the API key, which belongs to exactly one, or `local` for the local developer of local mode, who has no key. No argument names an org; an argument `org` is an unknown field, `invalid_input`. The scoped endpoints suit a client that wants a connection locked to one org's brains or to one brain.

All three sit behind the same chain as every other path. Before the SDK runs, a caller of another org gets `403` `forbidden` on a scoped endpoint, and so does a caller that may not access the brain of a brain endpoint, as problem documents. `GET`, `DELETE` and every other method get `405` with `Allow: POST`; the SDK would answer them with a JSON-RPC error and no `Allow` header, so they never reach it. A brain endpoint does not check that its brain exists: each tool call does, and answers a missing brain with `not_found`.

**The brain argument.** On `/mcp`, each brain operation's tool is derived from the catalog by its scope, so a new brain operation appears there without new code. Its input schema is the operation's with a required `brain` first, the brain id's pattern and the description "The id of the brain to act in" (added to every member when the input is a union, with any definition no longer referred to removed), and its description ends with "`brain` is the id of the brain to act in." A call first decodes `brain` with the brain id schema: a call without it, or with one that is not a well-formed id, gets `invalid_input` pointing at `/brain` before anything else, a format check that reveals nothing. It then takes `brain` out of the arguments and dispatches the rest to that brain, so the dispatcher's authorization holds per call: a key limited to other brains gets `forbidden`, and a brain the org does not have `not_found`, as `isError` tool results. No brain operation can have its own `brain` field: `@beonauto/operations` refuses to define one, as it reserves `org` and `brain` for the scope.

**Tools.** Each operation is one tool: its `name`, `title` and `description` are the operation's, and its `inputSchema` and `outputSchema` are the operation's JSON Schemas (draft 2020-12), each self-contained with an object at the root and its definitions under `$defs`. The annotations derive from the operation:

| Annotation        | Value                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | `true` for a query, `false` for a command                                                                                                                                                                                 |
| `destructiveHint` | `false`                                                                                                                                                                                                                   |
| `idempotentHint`  | `true` when the operation's HTTP method is `GET` or `PUT`                                                                                                                                                                 |
| `openWorldHint`   | `true` when the operation's definition says it reaches systems outside the server (`reachesOutside`), as `list_models` and an `execute_spec` that serves inference do, since they call model providers; `false` otherwise |

**Calls.** On a scoped endpoint the org, and the brain of a brain endpoint, come from the URL, and the arguments are the whole input; on `/mcp` the org is the caller's own and the brain an argument. The input is decoded with the `json` encoding. A call goes through the same dispatcher and the same `settle` as an HTTP request, with the caller in the URL's org.

| Outcome                     | Tool result                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| succeeded                   | `structuredContent` is the output; the first text content says in plain words what happened, and the second is the same output as JSON                                             |
| rejected, failed, cancelled | `isError: true`; the first text content says in plain words what could not be done, and the second is the problem document HTTP would answer with, as JSON; no `structuredContent` |

The plain words are for the person an agent works for, so they name things as that person knows them, and carry no ids, versions, formats or status codes: a spec of the inference primitive is a reason function, one of the orchestration primitive a workflow, and an execution a run. The tools still take the primitive's name, `inference` or `orchestration`, and each primitive's description opens by saying which word goes with it, so an agent knows that a person's reason function is a spec of `inference`, and that its prompt is the spec's document. Each operation says them itself, through the `plainLanguage` of its definition: a `task` and an `attempt` that name what it does, and an `outcome` from its output; each primitive gives the noun for its specs and a sentence for what one of its runs gave back. An endpoint refuses, when it is mounted, to serve an operation without them. The words for what could not be done come from one place, `unsuccessfulWords` in `@beonauto/operations`, by the reason of the rejection and its `kind`, when it has one (`taken`, `retired`, `concurrent_change` or `unworkable` for a conflict, `model_not_offered` for `unavailable`): a rejection the agent can correct says so; one only whoever runs the server can resolve says that, and that nothing on the person's side needs to change; a reason function whose prompt names a model the server does not offer is `model_not_offered`, and its words say so and, from the rejection's `because`, why: its provider is not set up on this server while others are (`provider_not_configured`), or it is outside the models whoever runs the server allows (`model_not_allowed`); either way the prompt can name one of the models `list_models` shows instead; one about the request names what is missing, not allowed, taken or retired; and an unexpected failure gives the reference to quote. HTTP answers are unchanged.

So invalid arguments are a tool result with `isError` and an `invalid_input` problem pointing at each field, as the protocol asks, and an agent can correct them. The SDK's parsing of the arguments drops one named `__proto__`; each endpoint reads the request body before the SDK, within the same 1 MiB, and puts such an argument back before the call is dispatched, so it is rejected as an excess field, `invalid_input` at `/__proto__`, as over HTTP. A tool the endpoint does not list is a JSON-RPC error, `-32602`, from the SDK. A call still running when the server stops gets a `503` `unavailable` problem. A tool that throws instead of settling is reported as an incident, as an HTTP request would be, and answered with the `500` `internal` problem, so the SDK never puts an error message of its own in the result.

**Server identity.** `serverInfo` carries the name and version the server passes in, which are the product name and the release version.

The instructions of `/mcp` are generated from the tools it serves, so they say nothing of a tool that is not there. For the server with inference and workflows they read:

> This server runs the business brains of your org. Start with list_brains to see them, or create_brain to make one. A brain works through specs: named, versioned documents, each written for one primitive, a kind of work the brain can do. The spec tools take the primitive by name, and their descriptions explain how each primitive's document is written. list_models lists the models this server can call. execute_spec runs a spec and records the run as an execution. It may answer with status started while the work goes on; then poll get_execution until the status changes. A workflow waiting for an event receives it through send_execution_event. Every tool that works inside a brain takes the brain's id as brain. A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.

Without workflows, the sentence on `send_execution_event` is left out, and without `list_models` the sentence on it. The scoped endpoints keep their own instructions, `orgEndpointInstructions` and `brainEndpointInstructions`:

> This MCP endpoint serves one org of auto-brain, the runtime for business brains. Its tools are the operations on the org as a whole, such as creating, listing, reading, updating and retiring its brains. Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns. A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.

> This MCP endpoint serves one brain of an org in auto-brain, the runtime for business brains. Its tools are the operations inside that brain, such as defining, versioning, retiring and executing the specs of its primitives; it lists no tools when the server offers no primitive. Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns. A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.

**Which errors look how.** An MCP endpoint answers in three shapes:

| Shape                              | When                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| problem document                   | before the SDK runs: `401`, `403` (origin, org or brain), `400` for a malformed `Authorization` header, `405`                                                                                                                                                                                                                                                                                                            |
| JSON-RPC error with an HTTP status | the SDK rejects the request: `406` when `Accept` lacks `application/json` and `text/event-stream`, `413` for a body over 1 MiB, `415` when `Content-Type` is not `application/json`, `400` with `-32700` for a body that is not JSON or not JSON-RPC, `400` for a request made under a revision the SDK does not support or whose MCP headers disagree with its body, and `-32602` for a tool the endpoint does not list |
| tool result with `isError`         | the operation did not succeed: a rejection, a failure or a cancellation, with plain words first and the problem document as text                                                                                                                                                                                                                                                                                         |

The SDK reports the errors it answers with JSON-RPC to `reportError`, which the server logs as a warning on stderr. Nothing the SDK does writes to stdout.

## The list of models

The server serves `list_models`, an org query of [`@beonauto/inference`](../../primitives/inference/README.md#listing-the-models), like any other operation: `GET /v1/orgs/{org}/models`, with an optional `provider` in the query string, and the read-only tool `list_models` on `/mcp` and `/orgs/{org}/mcp`, whose output schema is self-contained. It answers in the shape of the OpenAI API's list of models, which gateways such as LiteLLM, Portkey and Vercel's serve too:

```json
{
  "object": "list",
  "data": [
    {
      "id": "anthropic/claude-sonnet-4-5-20250929",
      "object": "model",
      "created": 1759104000,
      "owned_by": "anthropic",
      "name": "Claude Sonnet 4.5",
      "context_window": 200000,
      "max_tokens": 64000
    },
    {
      "id": "house/fast",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "resolved_to": "gateway/llama-3.3-70b"
    },
    {
      "id": "openai/*",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "resolved_to": "gateway/openai/*",
      "pattern": true
    }
  ],
  "catalog_status": "complete",
  "listed_at": "2026-10-01T09:30:00.000Z"
}
```

`id` is the model as a spec names it, `owned_by` the provider prefix that serves it, and `created` the provider's release time in seconds, or 0. `name`, `context_window` and `max_tokens` appear only when the provider reports them, `resolved_to` only for an alias, and `pattern: true` only for an id ending in `*`, which stands for any model id. `catalog_status` is `partial` when a provider could not be asked, and `listed_at` is when the oldest list in the answer was read. Its plain words name the models, such as `This server can call 2 models through anthropic and gateway: Claude Sonnet 4.5 and fast. It can also call any openai model.`

## Lifecycle

A `RegisterRoutes` function receives `routes.add`, to add a route, and `routes.onClose`, to add something to close when the API closes. `mcpRoutes` registers the closing of its three MCP handlers, which ends the calls they still serve. `ApiHandler.close` closes everything registered. The server calls it as it shuts down, after it has disposed of its runtime, so a call still running has already been answered as cancelled.

## Exports

`src/index.ts` is the entry point: `createApiHandler`, `makeAppRuntime`, `operationRoutes`, `mcpRoutes`, the instructions, and their types. `@beonauto/api/testing` exports what the server's tests share: real MCP clients of the current SDK, on either revision, and of the SDK's 1.x line, helpers that read a tool listing, among them `takingBrain`, which gives a brain endpoint's tool the `brain` argument it has on `/mcp`, and the `wait_forever` operation, which never finishes on its own.

## Source

`src/middleware` holds the chain every request passes, `src/authentication` the bearer authentication, and `src/problem` problem documents and how outcomes become them. `src/operations` holds the HTTP routes: the route table, how input is assembled and how an outcome becomes a response. `src/mcp` holds the MCP endpoints: the tools, their schemas, how a result is built and how the caller reaches the SDK's server. `src/testing` holds what the tests share.
