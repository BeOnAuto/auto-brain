# @beonauto/api

The API of auto-brain: the handler the server answers every request with. It serves each operation of a catalog twice, once as an HTTP route and once as an MCP tool, and both run the operation through the same dispatcher, so a call means the same thing whichever way it arrives. The operations themselves are defined on the application layer, [`@beonauto/operations`](../operations).

## Every request

Each request passes through the same chain before it reaches an operation, in this order:

1. It gets an `x-request-id` and the security headers.
2. An `Origin` that is neither the studio's, `https://studio.on.auto`, nor in `ALLOWED_ORIGINS` gets `403` `origin_not_allowed`; in local mode, a `Host` that is not a localhost name gets `403` too.
3. A CORS preflight from an allowed origin gets `204`.
4. The caller authenticates with `Authorization: Bearer <key>`, or as the local developer in local mode; a request without a valid key gets `401`.

Before that chain, a browser opening `/` (a `GET` that accepts `text/html`) gets a page saying the server is running and showing its address. Auto Studio is invite-only; the button opens `https://on.auto/request-invite` without sending the server address. The page needs no key and loads nothing from any server: its styles, its icon and its typefaces, DM Mono and DM Sans, are inside it. The two font files and their SIL Open Font Licenses are in `src/landing/fonts`. Any other request to `/` has no route.

A path with no route gets `404` `not_found`, and a method the path does not serve gets `405` `method_not_allowed` with an `Allow` header. Every one of these errors is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document.

## Over HTTP

`operationRoutes` registers one route per operation. An org operation's route is relative to `/v1/orgs/{org}`, a brain operation's to `/v1/orgs/{org}/brains/{brain}`; literal segments win over parameters wherever two routes could match the same path.

- **Input.** The operation's input is one object assembled from the path parameters, the query string of a `GET`, and the JSON body of a `POST` or `PUT`. A field may come from only one place; giving it twice is `400` `bad_request`, and so is a query string on a command. Query values arrive as strings and decode with the `strings` encoding; a body decodes with the `json` encoding.
- **Body.** A body must be a JSON object sent as `application/json` in UTF-8, with no `Content-Encoding` other than `identity`, and no larger than 1 MiB. Otherwise it is `413` `content_too_large`, `415` `unsupported_media_type` or `400` `bad_request`.
- **Answer.** A success is the operation's output as JSON with the operation's success status (`200`, or `201` where the operation says so) and `Cache-Control: no-store`.

An outcome that is not a success becomes a problem document. Its `type` is `https://on.auto/problems/<reason>` and its `title` the reason's, from the registry of problem types in `src/problem/problem.ts`, except for a kind that has a type of its own, `kindsWithTypes` of `@beonauto/operations`: a rejection of the kind `tools_unfinished` is `https://on.auto/problems/tools_unfinished`, titled `Tools unfinished`, with its reason `unavailable` and its status 503, one of the kind `tools_called` is `https://on.auto/problems/tools_called`, titled `Tools called`, with its reason `conflict` and its status 409, and one of the kind `rebuilding`, a recall function whose view is still being built, is `https://on.auto/problems/rebuilding`, titled `Rebuilding`, with its reason `unavailable`, its status 503 and `Retry-After`, since trying again later may succeed. The workflow engine raises the same types for them, never a communication or runtime error, and a workflow that ends with one is rejected with its reason and kind.

| Outcome   | Status and reason                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rejected  | the status of the rejection's reason, such as `403` `forbidden`, `404` `not_found`, `409` `conflict`, `409` `cancelled` for a run that was cancelled or `422` `invalid_input` with an `errors` list, and the rejection's `kind` and `because`, where it has them, as extension members |
| failed    | `500` `internal`, saying nothing about the cause; its `instance` is `urn:uuid:<id>`, the incident id under which the server logs the error                                                                                                                                             |
| cancelled | `499` `client_closed_request` when the client went away, `503` `unavailable` when the server is stopping                                                                                                                                                                               |

A `403` `forbidden` also carries `WWW-Authenticate: Bearer error="insufficient_scope"`. A `503` `unavailable` carries `Retry-After: 5` when a retry of the same request may resolve it, so not for the kind `tools_unfinished`, a run that called tools and could not finish, which the same request answers with `tools_called`, nor for the kinds `tool_not_offered` and `model_not_offered`, which only a change of the function or the configuration resolves.

## Over MCP

`mcpRoutes` serves the same catalog to agents over the [Model Context Protocol](https://modelcontextprotocol.io), with the official SDK, `@modelcontextprotocol/server`, pinned exactly. It is stateless: each request builds a fresh MCP server for its caller and keeps no session. It serves the current stateless revision, `2026-07-28`, and the earlier ones the SDK supports: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An `initialize` in any of them is answered in that revision, with the same tools, results and errors in each, and a client that asks for a revision the SDK does not know is offered `2025-11-25`. So agents built on older SDKs, including the 1.x line of the official one, connect out of the box. Revisions before `2025-06-18` predate `structuredContent` and output schemas; the SDK sends them regardless, and a client of such a revision reads the same JSON from the text content. MCP sits outside `/v1` because the protocol versions itself.

| Endpoint                              | Tools                                                                         | Org and brain                                           |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /mcp`                           | every operation of the catalog: the org operations, then the brain operations | the caller's own org; a brain operation names its brain |
| `POST /orgs/{org}/mcp`                | the org operations, such as `create_brain`                                    | the org of the URL                                      |
| `POST /orgs/{org}/brains/{brain}/mcp` | the brain operations, including function and workflow definitions and runs    | the org and the brain of the URL                        |

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

Human-readable results name reasoning functions, workflows and runs. They omit ids, versions, formats and status codes, which remain in the structured result. The tools take `primitive: inference` for reasoning functions and `primitive: orchestration` for workflows. Each adapter's description explains its definition format. A reasoning function's definition contains the prompt alongside the model configuration and input and output contracts.

Each operation supplies `plainLanguage`: a `task` and an `attempt` describing the action, and an `outcome` based on its output. Each adapter gives the noun for its definitions and a sentence for a run's result. An endpoint refuses to mount an operation without them.

`unsuccessfulWords` in `@beonauto/operations` supplies failure wording from the rejection's reason and optional `kind`: `taken`, `retired`, `concurrent_change` or `unworkable` for a conflict, and `model_not_offered` for `unavailable`. The message distinguishes a problem the agent can correct from one only the server operator can resolve. A reasoning function naming an unavailable model gets `model_not_offered`, with `because` explaining `provider_not_configured` or `model_not_allowed`; the definition can instead name an allowed model from `list_models`. Request problems identify what is missing, disallowed, taken or retired. Unexpected failures give a reference to quote. HTTP response contracts stay unchanged.

So invalid arguments are a tool result with `isError` and an `invalid_input` problem pointing at each field, as the protocol asks, and an agent can correct them. The SDK's parsing of the arguments drops one named `__proto__`; each endpoint reads the request body before the SDK, within the same 1 MiB, and puts such an argument back before the call is dispatched, so it is rejected as an excess field, `invalid_input` at `/__proto__`, as over HTTP. A tool the endpoint does not list is a JSON-RPC error, `-32602`, from the SDK. A call still running when the server stops gets a `503` `unavailable` problem. A tool that throws instead of settling is reported as an incident, as an HTTP request would be, and answered with the `500` `internal` problem, so the SDK never puts an error message of its own in the result.

**Server identity.** `serverInfo` carries the name and version the server passes in, which are the product name and the release version.

Every endpoint answers `initialize` with instructions that `instructionsFor` in `src/mcp/instructions.ts` builds once for the tools the endpoint serves and the definition types of `McpServing`, which the server gives from the primitives it registers, each with the noun of its definitions, so they say nothing of a tool that is not there and name each value `primitive` takes. They begin with a fixed paragraph built from [Brain terminology](../../docs/concepts/terminology.md), then a sentence that says what the connection acts on, then a sentence for each group of tools the endpoint serves. For the server with reasoning, computation and recall functions and workflows, `/mcp` reads:

> A brain is the complete system for a business responsibility. It belongs to an org and holds functions and the workflows that coordinate them. A function or a workflow is a reusable definition, and a run executes it on an input. A reasoning function has a prompt and calls a language model. The tools say spec for a definition and execution for a run. Answer the person in a sentence or two: what was done and what they can do next, in the words of brains, functions, workflows and runs, without ids, statuses or this server's rules unless asked. This connection acts in the caller's own org. Start with list_brains, or create_brain to make one. A spec is a named, versioned definition whose primitive field selects its type, inference for a reasoning function, computation for a computation function, recollection for a recall function or orchestration for a workflow; each tool describes their formats. A recall function keeps a view folded from the brain's own history, its runs with their outputs and published events, so nothing needs to write into it, and answers from it without a model. list_models lists the models this server can call. list_tool_servers lists the tool servers the brain may use and their tools. execute_spec runs a definition and records its run under an execution_id; while its status is started, poll get_execution until it changes. A waiting workflow run receives input through send_execution_event. Every tool inside a brain takes the brain's id as brain. A tool that cannot do what was asked returns isError with a problem document whose reason and detail say why.

On `/orgs/{org}/mcp` the sentence on the connection is "This connection manages the brains of one org.", followed by those on the brains and on `list_models`; on `/orgs/{org}/brains/{brain}/mcp` it is "This connection acts inside one brain.", followed by those on definitions, recall functions, runs, `list_tool_servers` and `send_execution_event`, and neither has the sentence on the `brain` argument. Without recall functions, the sentence on them is left out, without workflows the sentence on `send_execution_event`, and without `list_models` the sentence on it. Each endpoint's instructions stay under 1,600 characters, use no term of the internal vocabulary but the wire names they explain, and open with the definition of a brain that the terminology page gives, which `src/mcp/instructions.test.ts` checks against that page.

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

`makeAppRuntime(layer)` builds the runtime every call runs in. Its `run(effect, signal?)` answers the effect's value, or `cancelled` when the effect was interrupted, by the runtime's disposal or by the abort of the signal given, which interrupts it so its finalizers run; the server gives the signal of the call a workflow performs, so a call the workflow cancels stops the execution it started.

`src/index.ts` is the entry point: `createApiHandler`, `makeAppRuntime`, `operationRoutes`, `mcpRoutes`, the instructions, and their types. `@beonauto/api/testing` exports what the server's tests share: real MCP clients of the current SDK, on either revision, and of the SDK's 1.x line, helpers that read a tool listing, among them `takingBrain`, which gives a brain endpoint's tool the `brain` argument it has on `/mcp`, and the `wait_forever` operation, which never finishes on its own.

## Source

`src/middleware` holds the chain every request passes, `src/authentication` the bearer authentication, and `src/problem` problem documents and how outcomes become them. `src/operations` holds the HTTP routes: the route table, how input is assembled and how an outcome becomes a response. `src/mcp` holds the MCP endpoints: the tools, their schemas, how a result is built and how the caller reaches the SDK's server. `src/testing` holds what the tests share.
