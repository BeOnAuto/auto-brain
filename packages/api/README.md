# @beonauto/api

The API of auto-brain: the handler the server answers every request with. It serves each operation of a catalog twice, once as an HTTP route and once as an MCP tool, and both run the operation through the same dispatcher, so a call means the same thing whichever way it arrives. The operations themselves are defined on the application layer, [`@beonauto/operations`](../operations).

## Every request

Each request passes through the same chain before it reaches an operation, in this order:

1. It gets an `x-request-id` and the security headers.
2. An `Origin` that is neither the studio's, `https://studio.on.auto`, nor in `ALLOWED_ORIGINS` gets `403` `origin_not_allowed`; in local mode, a `Host` that is not a localhost name gets `403` too.
3. A CORS preflight from an allowed origin gets `204`.
4. The caller authenticates with `Authorization: Bearer <key>`, or as the local developer in local mode; a request without a valid key gets `401`. Any other credential, of a scheme the API does not know, is a malformed `Authorization` header, `400`, over HTTP and MCP alike.

Before that chain, a browser opening `/` (a `GET` that accepts `text/html`) gets a page saying the server is running, with a button that opens the studio on this server: `https://studio.on.auto/?server=<this server's origin>`. The page needs no key and loads nothing from any server: its styles, its icon and its typefaces, DM Mono and DM Sans, are inside it. The two font files and their SIL Open Font Licenses are in `src/landing/fonts`. Any other request to `/` has no route.

A path with no route gets `404` `not_found`, and a method the path does not serve gets `405` `method_not_allowed` with an `Allow` header. Every one of these errors is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document.

## Over HTTP

`operationRoutes` registers one route per operation. An org operation's route is relative to `/v1/orgs/{org}`, a brain operation's to `/v1/orgs/{org}/brains/{brain}`; literal segments win over parameters wherever two routes could match the same path.

- **Input.** The operation's input is one object assembled from the path parameters, the query string of a `GET`, and the JSON body of a `POST` or `PUT`. A field may come from only one place; giving it twice is `400` `bad_request`, and so is a query string on a command. Query values arrive as strings and decode with the `strings` encoding; a body decodes with the `json` encoding.
- **Body.** A body must be a JSON object sent as `application/json` in UTF-8, with no `Content-Encoding` other than `identity`, and no larger than 1 MiB. Otherwise it is `413` `content_too_large`, `415` `unsupported_media_type` or `400` `bad_request`.
- **Answer.** A success is the operation's output as JSON with the operation's success status (`200`, or `201` where the operation says so) and `Cache-Control: no-store`.

An outcome that is not a success becomes a problem document. Its `type` is `https://on.auto/problems/<reason>` and its `title` the reason's, from the registry of problem types in `src/problem/problem.ts`, except for a kind that has a type of its own, `kindsWithTypes` of `@beonauto/operations`: a rejection of the kind `tools_unfinished` is `https://on.auto/problems/tools_unfinished`, titled `Tools unfinished`, with its reason `unavailable` and its status 503, one of the kind `tools_called` is `https://on.auto/problems/tools_called`, titled `Tools called`, with its reason `conflict` and its status 409, and one of the kind `rebuilding`, a recall function whose view is still being built, is `https://on.auto/problems/rebuilding`, titled `Rebuilding`, with its reason `unavailable`, its status 503 and `Retry-After`, since trying again later may succeed. The workflow engine raises the same types for them, never a communication or runtime error, and a workflow that ends with one is rejected with its reason and kind.

| Outcome   | Status and reason                                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rejected  | the status of the rejection's reason, such as `403` `forbidden`, `404` `not_found`, `409` `conflict`, `409` `cancelled` for a run that was cancelled, `410` `unanswered` for a run whose request nobody answered or `422` `invalid_input` with an `errors` list, and the rejection's `kind` and `because`, where it has them, as extension members |
| failed    | `500` `internal`, saying nothing about the cause; its `instance` is `urn:uuid:<id>`, the incident id under which the server logs the error                                                                                                                                                                                                         |
| cancelled | `499` `client_closed_request` when the client went away, `503` `unavailable` when the server is stopping                                                                                                                                                                                                                                           |

A `403` `forbidden` also carries `WWW-Authenticate: Bearer error="insufficient_scope"`. A `503` `unavailable` carries `Retry-After: 5` when a retry of the same request may resolve it, so not for the kind `tools_unfinished`, a run that called tools and could not finish, which the same request answers with `tools_called`, nor for the kinds `tool_not_offered` and `model_not_offered`, which only a change of the function or the configuration resolves. A `410` `unanswered` carries none: the same request answers it again.

## Over MCP

`mcpRoutes` serves the same catalog to agents over the [Model Context Protocol](https://modelcontextprotocol.io), with the official SDK, `@modelcontextprotocol/server`, pinned exactly. It is stateless: each request builds a fresh MCP server for its caller and keeps no session. It serves the current stateless revision, `2026-07-28`, and the earlier ones the SDK supports: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An `initialize` in any of them is answered in that revision, with the same tools, results and errors in each, and a client that asks for a revision the SDK does not know is offered `2025-11-25`. So agents built on older SDKs, including the 1.x line of the official one, connect out of the box. Revisions before `2025-06-18` predate `structuredContent`; the SDK sends it regardless, and a client of such a revision reads the same JSON from the text content. MCP sits outside `/v1` because the protocol versions itself.

| Endpoint                              | Tools                                                                                         | Org and brain                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /mcp`                           | the operations of the catalog the key may call: the org operations, then the brain operations | the caller's own org; a brain operation names its brain |
| `POST /orgs/{org}/mcp`                | the org operations the key may call, such as `create_brain`                                   | the org of the URL                                      |
| `POST /orgs/{org}/brains/{brain}/mcp` | the brain operations the key may call, including function and workflow definitions and runs   | the org and the brain of the URL                        |

Every endpoint also serves `get_guide` and the guides as resources, and offers as prompts the recipes whose tools it lists, below.

**What a key is offered.** A connection lists the tools its key may call: each registration whose `permissions`, the permission of its kind and scope unless its definition names others, include one the caller holds, so a key with `brain:read` alone sees `list_brains`, which answers the brains it may access, and the queries inside a brain, and no command, as the protocol allows a tool list to vary by the authorization presented. A tool the connection does not list is the SDK's `-32602`. The dispatcher still checks every call, so a key limited to some brains is refused the others per call.

`/mcp` is the one an agent connects to by default: on one connection it can create a brain and then work in it. Its org is `org` of the authenticated principal: the org of the API key, which belongs to exactly one, or `local` for the local developer of local mode, who has no key. No argument names an org; an argument `org` is an unknown field, `invalid_input`. The scoped endpoints suit a client that wants a connection locked to one org's brains or to one brain.

All three sit behind the same chain as every other path. Before the SDK runs, a caller of another org gets `403` `forbidden` on a scoped endpoint, and so does a caller that may not access the brain of a brain endpoint, as problem documents. `GET`, `DELETE` and every other method get `405` with `Allow: POST`; the SDK would answer them with a JSON-RPC error and no `Allow` header, so they never reach it. A brain endpoint does not check that its brain exists: each tool call does, and answers a missing brain with `not_found`.

**The brain argument.** On `/mcp`, each brain operation's tool is derived from the catalog by its scope, so a new brain operation appears there without new code. Its input schema is the operation's with a required `brain` first, the brain id's pattern and the description "The id of the brain to act in" (added to every member when the input is a union, with any definition no longer referred to removed), and the tool's description is the operation's, since the argument's own description says what it is. A call first decodes `brain` with the brain id schema: a call without it, or with one that is not a well-formed id, gets `invalid_input` pointing at `/brain` before anything else, a format check that reveals nothing. It then takes `brain` out of the arguments and dispatches the rest to that brain, so the dispatcher's authorization holds per call: a key limited to other brains gets `forbidden`, and a brain the org does not have `not_found`, as `isError` tool results. No brain operation can have its own `brain` field: `@beonauto/operations` refuses to define one, as it reserves `org` and `brain` for the scope. A brain operation whose name an org operation also has is not offered on `/mcp`: the org operation, which the catalog accepts under that name only when it takes `brain` itself, answers there in its place, with its own `brain` argument and the description it gives it, as `list_tool_servers` answers for the whole org without a brain and for one brain with it. The brain endpoint offers the brain operation and the org endpoint the org one, under the same name.

**Tools.** Each operation is one tool: its `name`, `title` and `description` are the operation's, and its `inputSchema` is the operation's input JSON Schema (draft 2020-12), self-contained with an object at the root and its definitions under `$defs`. A tool has no `outputSchema`: a client compiles a validator from each output schema it lists and refuses a result that does not match it, and a server that keeps no session and announces no change to its tools cannot tell a client that listed them before an upgrade that a result's shape changed, so the result alone says what it holds ([decision 0016](../../docs/decisions/0016-speaking-to-agents.md#amendment-2026-10-09-the-tools-advertise-no-output-schema)). A description says what the tool does, when to use it and when not, the caveats to know before calling and the alternative tool by name, in three to eight sentences and at most 800 characters; the rules of each argument are in its schema's description, at most 300 characters at any depth of the input, and keywords. The annotations follow what the operation declares:

| Annotation        | Value                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `readOnlyHint`    | `true` for a query, `false` for a command                                                                                                  |
| `destructiveHint` | `true` for a command declared `irreversible`, or one whose definition says it may change something outside the server (`mayChangeOutside`) |
| `idempotentHint`  | `true` for a query, and for a command declared `repeatable`, whose repeat records nothing                                                  |
| `openWorldHint`   | `true` when the operation's definition says it reaches systems outside the server (`reachesOutside`)                                       |

The HTTP method decides nothing. The server serves these, which `packages/server/src/mcp/served-tools.test.ts` checks against this table:

| Tool                  | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| --------------------- | -------------- | ----------------- | ---------------- | --------------- |
| `create_brain`        | false          | false             | false            | false           |
| `list_brains`         | true           | false             | true             | false           |
| `get_brain`           | true           | false             | true             | false           |
| `update_brain`        | false          | false             | true             | false           |
| `retire_brain`        | false          | true              | true             | false           |
| `list_models`         | true           | false             | true             | true            |
| `create_definition`   | false          | false             | false            | false           |
| `list_definitions`    | true           | false             | true             | false           |
| `get_definition`      | true           | false             | true             | false           |
| `update_definition`   | false          | false             | true             | false           |
| `retire_definition`   | false          | true              | true             | false           |
| `run_definition`      | false          | false             | false            | true            |
| `get_run`             | true           | false             | true             | false           |
| `cancel_run`          | false          | true              | true             | false           |
| `list_runs`           | true           | false             | true             | false           |
| `get_run_history`     | true           | false             | true             | false           |
| `get_brain_analytics` | true           | false             | true             | false           |
| `list_brain_events`   | true           | false             | true             | false           |
| `publish_event`       | false          | false             | false            | false           |
| `list_tool_servers`   | true           | false             | true             | true            |
| `test_tool_call`      | false          | false             | false            | true            |
| `answer_interaction`  | false          | true              | true             | false           |
| `list_interactions`   | true           | false             | true             | false           |
| `send_run_event`      | false          | false             | false            | false           |
| `get_guide`           | true           | false             | true             | false           |

`run_definition` is destructive while a tool server is configured, since a reasoning function's tools or the tool an interaction function sends through may then change something outside, and `test_tool_call` while an entry of `mcp_servers` marks a tool testable, since a tool its server does not mark read-only may then be tested; the table is the server without either, as the test serves it. `list_models` and `run_definition` reach model providers, and `list_tool_servers` and `test_tool_call` reach the tool servers.

**Calls.** On a scoped endpoint the org, and the brain of a brain endpoint, come from the URL, and the arguments are the whole input; on `/mcp` the org is the caller's own and the brain an argument. The input is decoded with the `json` encoding. A call goes through the same dispatcher and the same `settle` as an HTTP request, with the caller in the URL's org.

| Outcome                     | Tool result                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| succeeded                   | the first text content says in plain words what happened, the second is the output as JSON text, and `structuredContent` is the same output, with no output schema to check it against |
| rejected, failed, cancelled | `isError: true`; the first text content says in plain words what could not be done, and the second is the problem document HTTP would answer with, as JSON; no `structuredContent`     |

Human-readable results name reasoning functions, workflows and runs. They omit ids, versions, formats and status codes, which remain in the structured result. The tools take `type: reasoning` for reasoning functions and `type: workflow` for workflows. `get_guide` serves the format of each definition type; no tool description carries one. The words of an outcome take at most 400 characters and those of a refusal at most 600: `withinCharacters` of `@beonauto/operations` keeps the whole sentences that fit and says the rest is in the details below, the JSON beside them.

Each operation supplies `plainLanguage`: a `task` and an `attempt` describing the action, and an `outcome` based on its output. It may also give `remedies` of its own by `because`, which take the place of the shared remedy in the words of its refusals, as `test_tool_call` names what `list_tool_servers` shows where a function's refusal speaks of the function. Each adapter gives the noun for its definitions and a sentence for a run's result. An endpoint refuses to mount an operation without them.

`unsuccessfulWords` in `@beonauto/operations` supplies failure wording from the rejection's reason and optional `kind`: `taken`, `retired`, `concurrent_change` or `unworkable` for a conflict, and `model_not_offered` for `unavailable`. The message distinguishes a problem the agent can correct from one only the server operator can resolve. A reasoning function naming an unavailable model gets `model_not_offered`, with `because` explaining `provider_not_configured` or `model_not_allowed`; the definition can instead name an allowed model from `list_models`. Request problems identify what is missing, disallowed, taken or retired. Unexpected failures give a reference to quote. HTTP response contracts stay unchanged.

So invalid arguments are a tool result with `isError` and an `invalid_input` problem pointing at each field, as the protocol asks, and an agent can correct them. The SDK's parsing of the arguments drops one named `__proto__`; each endpoint reads the request body before the SDK, within the same 1 MiB, and puts such an argument back before the call is dispatched, so it is rejected as an excess field, `invalid_input` at `/__proto__`, as over HTTP. A tool the endpoint does not list is a JSON-RPC error, `-32602`, from the SDK. A call still running when the server stops gets a `503` `unavailable` problem. A tool that throws instead of settling is reported as an incident, as an HTTP request would be, and answered with the `500` `internal` problem, so the SDK never puts an error message of its own in the result.

**Server identity.** `serverInfo` carries the name and version the server passes in, which are the product name and the release version.

**Instructions.** Every endpoint answers `initialize` with instructions that `instructionsFor` in `src/mcp/instructions.ts` builds per request from the tools the key is offered, the definition types of `McpServing`, which the server gives from the capabilities it registers, each with the noun of its definitions and the name of its guide, and the recipes, each with the tools its steps call. So they never name a tool the connection does not list. They are the texts of [decision 0016](../../docs/decisions/0016-speaking-to-agents.md#3-the-instructions-per-endpoint): what a brain is, as [Brain terminology](../../docs/concepts/terminology.md) defines it; a sentence for each type the server runs; what the connection acts on; where the formats and the recipes are; how a reasoning function names its model and its tools, and, where `test_tool_call` is listed, that it shows what a tool answers; that `get_run` shows whether a run that finishes later ended or still waits; that what the person answers to a run that waits goes to its request through `answer_interaction`, and no new run; that runs, history, events and requests come a page at a time; how to answer the person; and what a refusal says. For the server with every type and every tool, `/mcp` reads:

> A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. An interaction function asks a person or a system and takes the answer later. A computation function runs a program on its input and gives the same output every time. A recall function answers from what it keeps of the brain's own history: every run's start and end, with its result when it succeeded, the definitions saved and the events published to the brain, never a run's input or its tool calls, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts in the caller's own org: list_brains shows its brains and create_brain makes one. Before writing a definition, read its format with get_guide, which also holds the recipes: first-brain, remember, give-tools and schedule. A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists; test_tool_call shows what a tool answers. A run of an interaction function or a workflow answers started; get_run shows whether it ended or still waits. When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, in the shape its function's answer takes, and start no new run for it. Runs, history, events and requests come a page at a time; read on only when the person needs more. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act. A tool that cannot do what was asked says why and what to change.

On `/orgs/{org}/mcp` the connection "manages the brains of one org", whose functions and workflows are made on the brain's own connection, `/orgs/{org}/brains/{brain}/mcp`, and `get_guide` "holds what these words mean"; on `/orgs/{org}/brains/{brain}/mcp` it "acts inside one brain", and the recipes it names leave out `first-brain`, which needs `create_brain`. A recipe is named only where the tools its steps call are listed, and the sentence on `get_guide` names the recipes only where `create_definition` is. Each endpoint's instructions stay under 2,000 characters, open with the terminology page's definition of a brain, name as types only those on that page, and use no term of the internal vocabulary once the address of a brain's connection is taken out, which `src/mcp/instructions.test.ts` checks. The server refuses to start when the instructions of a key that may call every tool would be longer. With a fifth type served, the record's texts would pass that bound, so, as its bound says, the sentence on the interaction tools is in their descriptions and the interaction-function guide, the clause that gives a waiting run its event is in `send_run_event`'s description and the workflow guide, the run sentence covers every type whose run finishes later, and the `brain` argument is left to each tool's schema. With every tool they take 1,890 characters on `/mcp`, 1,495 on `/orgs/{org}/mcp` and 1,850 on `/orgs/{org}/brains/{brain}/mcp`; a key that may only read is offered no `test_tool_call`, and its instructions keep 1,573 characters on `/mcp`, 1,610 with `brain:read` alone, 1,468 on the org endpoint and 1,573 on the brain endpoint. The org endpoint lists `list_tool_servers`, the org operation that answers for the whole org, so its sentence on models is the one that also names the tools: 22 characters more than when it listed `list_models` alone. The clause on `test_tool_call` is the short one, 42 characters, so that the closing sentence on refusals keeps its place within the bound.

**Guides.** Every endpoint serves `get_guide`, a read-only tool whose `guide` argument is the enum of the guides' names and whose answer is one guide's whole Markdown as text, and lists the same guides as resources, `guide://<name>`, `text/markdown`, annotated for the assistant, which answer the same text. The server passes the guides as `guides`, a `Guide` each with its `name`, `title`, `description` and `text`, and the recipes as `recipes`. A `Recipe` is a guide with the `arguments` its prompt takes, the `formatGuide` it embeds, the tools its steps `call` and the `request` it makes of the person's words. Each recipe whose steps call only tools the connection lists, the rule that names it in the instructions, is also a prompt, under its name and title, so a brain endpoint offers no `first-brain` and a key that may only read no prompt: `prompts/get` answers one user message, the request with the person's words filled in and then the recipe, followed by its format guide as an embedded resource. An endpoint refuses to mount without the guide of each definition type and the format guide of each recipe.

**Bounds.** Each bound of [decision 0016](../../docs/decisions/0016-speaking-to-agents.md#8-bounds) is enforced where it can be reached, and tested at the bound and one over in `src/bounds/served-bounds.test.ts`, `src/bounds/word-bounds.test.ts` and `src/tools/tool-definition.test.ts`:

| Bound                        | Value                                                                                    | When it is reached                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Instructions of a connection | 2,000 characters                                                                         | The server refuses to start                                  |
| A tool description           | 800 characters, 3 to 8 sentences                                                         | The server refuses to start                                  |
| An argument's description    | 300 characters, at any depth of the input                                                | The server refuses to start                                  |
| Tools on a connection        | 25, `get_guide` included, since [0018](../../docs/decisions/0018-testing-a-tool-call.md) | The server refuses to start                                  |
| A guide                      | 64 KiB                                                                                   | The server refuses to start                                  |
| A recipe                     | 4 KiB, its format guide embedded beside it                                               | The server refuses to start                                  |
| Guides                       | one a definition type and the terminology                                                | The server refuses to start                                  |
| Recipes, and so prompts      | 4                                                                                        | The server refuses to start                                  |
| Outcome words; refusal words | 400; 600 characters                                                                      | The rest is said to be in the details, the structured result |

**Which errors look how.** An MCP endpoint answers in three shapes:

| Shape                              | When                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| problem document                   | before the SDK runs: `401`, `403` (origin, org or brain), `400` for a malformed `Authorization` header, `405`                                                                                                                                                                                                                                                                                                            |
| JSON-RPC error with an HTTP status | the SDK rejects the request: `406` when `Accept` lacks `application/json` and `text/event-stream`, `413` for a body over 1 MiB, `415` when `Content-Type` is not `application/json`, `400` with `-32700` for a body that is not JSON or not JSON-RPC, `400` for a request made under a revision the SDK does not support or whose MCP headers disagree with its body, and `-32602` for a tool the endpoint does not list |
| tool result with `isError`         | the operation did not succeed: a rejection, a failure or a cancellation, with plain words first and the problem document as text                                                                                                                                                                                                                                                                                         |

The SDK reports the errors it answers with JSON-RPC to `reportError`, which the server logs as a warning on stderr. Nothing the SDK does writes to stdout.

## The list of models

The server serves `list_models`, an org query of [`@beonauto/reasoning`](../../capabilities/reasoning/README.md#listing-the-models), like any other operation: `GET /v1/orgs/{org}/models`, with an optional `provider` in the query string, and the read-only tool `list_models` on `/mcp` and `/orgs/{org}/mcp`. It answers in the shape of the OpenAI API's list of models, which gateways such as LiteLLM, Portkey and Vercel's serve too:

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

`id` is the model as a definition names it, `owned_by` the provider prefix that serves it, and `created` the provider's release time in seconds, or 0. `name`, `context_window` and `max_tokens` appear only when the provider reports them, `resolved_to` only for an alias, and `pattern: true` only for an id ending in `*`, which stands for any model id. `catalog_status` is `partial` when a provider could not be asked, and `listed_at` is when the oldest list in the answer was read. Its plain words name the models, such as `This server can call 2 models through anthropic and gateway: Claude Sonnet 4.5 and fast. It can also call any openai model.`

## Lifecycle

A `RegisterRoutes` function receives `routes.add`, to add a route, and `routes.onClose`, to add something to close when the API closes. `mcpRoutes` registers the closing of its three MCP handlers, which ends the calls they still serve. `ApiHandler.close` closes everything registered. The server calls it as it shuts down, after it has disposed of its runtime, so a call still running has already been answered as cancelled.

## Exports

`makeAppRuntime(layer)` builds the runtime every call runs in. Its `run(effect, signal?)` answers the effect's value, or `cancelled` when the effect was interrupted, by the runtime's disposal or by the abort of the signal given, which interrupts it so its finalizers run; the server gives the signal of the call a workflow performs, so a call the workflow cancels stops the run it started.

`src/index.ts` is the entry point: `createApiHandler`, `makeAppRuntime`, `operationRoutes`, `mcpRoutes`, the instructions, the types of a guide and a recipe, the guide's address and media type, the bounds, and their types. `@beonauto/api/testing` exports what the server's tests share: real MCP clients of the current SDK, on either revision, and of the SDK's 1.x line, each of which records in `compiledOutputSchemas` the output schemas it compiles a validator from and refuses every result it checks against one; helpers that read a tool listing, among them `takingBrain`, which gives a brain endpoint's tool the `brain` argument it has on `/mcp`, and `operationToolsIn`, which answers the listed tools but `get_guide`; and the `wait_forever` operation, which never finishes on its own.

## Source

`src/middleware` holds the chain every request passes, `src/authentication` the bearer authentication, and `src/problem` problem documents and how outcomes become them. `src/operations` holds the HTTP routes: the route table, how input is assembled and how an outcome becomes a response. `src/mcp` holds the MCP endpoints, the connection each request builds and its instructions; `src/tools` the tools, their schemas, their definitions and how a result is built; `src/hand-off` how the caller reaches the SDK's server; `src/guides` the guide tool, the resources and the prompts; and `src/bounds` the bounds. `src/testing` holds what the tests share.
