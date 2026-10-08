# Connect an agent over MCP

These instructions cover this development checkout. The current API keeps its existing tool names while human-readable results use reasoning functions, workflows and runs.

The server is also an [MCP](https://modelcontextprotocol.io) server, so an agent can call the same operations as tools. Connect it to `/mcp`, with an [API key](../self-host/security.md#api-keys):

```json
{
  "mcpServers": {
    "auto-brain": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

Most MCP clients take an entry of this shape. In Claude Code, `claude mcp add --transport http auto-brain http://localhost:8080/mcp --header "Authorization: Bearer <key>"` adds the same. In [local mode](../self-host/security.md#local-mode), leave out the header.

`/mcp` serves every tool on one connection, so an agent can create a brain and work in it at once. The org is the key's own, since a key belongs to one org, and never an argument; in local mode, where no key names one, it is `local`, so the brains an agent creates there are the ones `GET /v1/orgs/local/brains` lists. The org id `local` is reserved for local mode: the key command refuses it, and an `API_KEYS` entry with it stops the server at start-up, so no key can reach the brains made in local mode. The brain tools (`create_brain`, `list_brains`, `get_brain`, `update_brain` and `retire_brain`) and `list_models` are as on HTTP. Every tool that works inside a brain (`create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, `execute_spec`, `get_execution`, `cancel_execution`, `list_executions`, `get_execution_history`, `get_brain_analytics`, `list_brain_events`, `publish_event`, `test_tool_call`, `list_interactions`, `answer_interaction` and `send_execution_event`) takes the brain's id as a required `brain` argument, `list_tool_servers` takes it as an optional one, and `get_guide` reads the guides on every endpoint: twenty-five tools for a key that may call them all. `list_tool_servers` lists the MCP servers the brain may use and the tools each offers, which an agent names in a reasoning function's `tools`, each tool saying whether it can be tested, and without `brain` every server set up for the org, each with the brains it serves, so an agent sees what is set up before it makes a brain; it is the org's operation, `GET /v1/orgs/{org}/tool-servers`, which the org endpoint serves too; `test_tool_call` calls one of them as a run would and answers what the run's model would see, a tool its server marks read-only or the operator lists in `testable_tools`, recorded in the brain's history and never a run; the [HTTP reference](http.md#tool-servers) describes both. `list_executions`, `get_execution_history` and `list_brain_events` page with `limit` and `cursor`, answer `has_more` and `next_cursor`, and read a retired brain; the [HTTP reference](http.md#run-history-and-brain-events) describes their fields. A connection lists the tools its key may call, so a read-only key is offered the queries alone, and a key that may only read inside some brains is offered `list_brains` too, which lists those brains. Every endpoint gives a connecting agent instructions, `instructionsFor` of `@beonauto/api`, built per request for the tools listed, the definition types the server runs and the recipes whose tools are listed, with the texts of [decision 0016](../../decisions/0016-speaking-to-agents.md#3-the-instructions-per-endpoint): what a brain is and a sentence for each type it runs, what the connection acts on, the one sentence that maps the wire names `spec`, `execution` and `primitive`, where the formats and recipes are, how a reasoning function names its model and tools and, where `test_tool_call` is listed, that it shows what a tool answers, that `get_execution` shows whether a run that finishes later ended or still waits, that an answer to what a run waits on goes to its request through `answer_interaction` and no new run, the paging rule, how to answer the person and what a refusal says. On the server with every tool they take 1,990 characters on `/mcp`, 1,495 on `/orgs/{org}/mcp`, where `list_tool_servers` is listed, and 1,950 on `/orgs/{org}/brains/{brain}/mcp`, under a bound of 2,000. `get_guide`, the resources `guide://<name>` and the prompts `first-brain`, `remember`, `give-tools` and `schedule`, each offered where the connection lists the tools its steps call, serve the terminology, the reference page of each format and the recipes; the [API README](../../../packages/api/README.md#over-mcp) describes them, the annotations of each tool and the bounds.

| Endpoint                              | Tools                                                                                                             | Use it                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /mcp`                           | every tool, those inside a brain taking a `brain` argument, optional for `list_tool_servers`                      | by default                                                      |
| `POST /orgs/{org}/mcp`                | `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain`, `list_models` and `list_tool_servers` | to manage one org’s brains and discover models and tool servers |
| `POST /orgs/{org}/brains/{brain}/mcp` | the tools inside a brain, acting in that brain, without a `brain` argument                                        | to lock a connection to one brain, such as for one agent        |

Every endpoint speaks streamable HTTP without sessions. It serves the current stateless revision (`2026-07-28`) and the earlier ones the SDK supports (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`), so agents built on older SDKs connect too. Each tool carries the operation's description and its input and output JSON Schemas, and is marked read-only when it only reads. A tool that cannot do what was asked returns `isError` with the same problem document HTTP would answer with, as text, so the agent can read the `reason` and the `detail`, and correct its arguments when the `reason` is `invalid_input`. The key's permissions and brains hold as they do over HTTP: a read-only key is offered `list_brains` and not `create_brain`, which it would be refused, a key limited to some brains gets `forbidden` for any other, and a brain the org does not have is `not_found`. [`packages/api`](https://github.com/BeOnAuto/auto-brain/blob/main/packages/api/README.md) describes the mappings in full.

## Reading tool results

On success, use `structuredContent` for the operation's output. The first text block is a human-readable summary; the second text block contains the same output as JSON for clients without structured-output support. Do not parse `content[0].text` as JSON.

On failure, the result has `isError: true` and no `structuredContent`. The first text block explains what could not be done, and the second contains the JSON problem document. Check its `reason` and `detail` before deciding whether to correct input or retry.

Authentication and origin failures can occur before a tool runs, producing an HTTP problem document. Protocol errors can produce JSON-RPC errors. Use an MCP client to handle the protocol rather than treating every response as an operation result.

## Start a useful conversation

After connecting, ask your agent to list the brains and available operations. Describe a recurring piece of work and the criteria you use. Ask it to propose a small reusable function, explain the inputs it needs and create it after you agree.

`get_guide` serves the format of each definition type, and a client that shows MCP prompts offers `first-brain`, the first conversation of the quick start, served by the brain itself. Ask the agent to call `list_models` and choose a concrete model or alias id. Model discovery requires `org:read` on `/mcp` or the org endpoint. Wildcard entries describe supported prefixes; they are not runnable model ids. An incomplete listing may need a concrete reference confirmed by the deployment operator. Follow the [first-brain guide](../get-started/self-hosted.md) for an example that works with the current runtime.
