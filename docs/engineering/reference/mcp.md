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

`/mcp` serves every tool on one connection, so an agent can create a brain and work in it at once. The org is the key's own, since a key belongs to one org, and never an argument; in local mode, where no key names one, it is `local`, so the brains an agent creates there are the ones `GET /v1/orgs/local/brains` lists. The org id `local` is reserved for local mode: the key command refuses it, and an `API_KEYS` entry with it stops the server at start-up, so no key can reach the brains made in local mode. The brain tools (`create_brain`, `list_brains`, `get_brain`, `update_brain` and `retire_brain`) and `list_models` are as on HTTP. Every tool that works inside a brain (`create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, `execute_spec`, `get_execution`, `cancel_execution`, `list_executions`, `get_execution_history`, `get_brain_analytics`, `list_brain_events`, `publish_event` and `send_execution_event`) takes the brain's id as a required `brain` argument: twenty tools. `list_executions`, `get_execution_history` and `list_brain_events` page with `limit` and `cursor`, answer `has_more` and `next_cursor`, and read a retired brain; the [HTTP reference](http.md#run-history-and-brain-events) describes their fields. The server's instructions orient an agent to brains, functions, workflows and runs, and say what a spec is and what the `primitive` field selects.

| Endpoint                              | Tools                                                                                        | Use it                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /mcp`                           | every tool, those inside a brain taking a `brain` argument                                   | by default                                               |
| `POST /orgs/{org}/mcp`                | `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain` and `list_models` | to manage one org’s brains and discover models           |
| `POST /orgs/{org}/brains/{brain}/mcp` | the tools inside a brain, acting in that brain, without a `brain` argument                   | to lock a connection to one brain, such as for one agent |

Every endpoint speaks streamable HTTP without sessions. It serves the current stateless revision (`2026-07-28`) and the earlier ones the SDK supports (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`), so agents built on older SDKs connect too. Each tool carries the operation's description and its input and output JSON Schemas, and is marked read-only when it only reads. A tool that cannot do what was asked returns `isError` with the same problem document HTTP would answer with, as text, so the agent can read the `reason` and the `detail`, and correct its arguments when the `reason` is `invalid_input`. The key's permissions and brains hold as they do over HTTP: a read-only key can call `list_brains` but gets `forbidden` from `create_brain`, a key limited to some brains gets `forbidden` for any other, and a brain the org does not have is `not_found`. [`packages/api`](https://github.com/BeOnAuto/auto-brain/blob/main/packages/api/README.md) describes the mappings in full.

## Reading tool results

On success, use `structuredContent` for the operation's output. The first text block is a human-readable summary; the second text block contains the same output as JSON for clients without structured-output support. Do not parse `content[0].text` as JSON.

On failure, the result has `isError: true` and no `structuredContent`. The first text block explains what could not be done, and the second contains the JSON problem document. Check its `reason` and `detail` before deciding whether to correct input or retry.

Authentication and origin failures can occur before a tool runs, producing an HTTP problem document. Protocol errors can produce JSON-RPC errors. Use an MCP client to handle the protocol rather than treating every response as an operation result.

## Start a useful conversation

After connecting, ask your agent to list the brains and available operations. Describe a recurring piece of work and the criteria you use. Ask it to propose a small reusable function, explain the inputs it needs and create it after you agree.

The tool descriptions explain the supported definition formats. Ask the agent to call `list_models` and choose a concrete model or alias id. Model discovery requires `org:read` on `/mcp` or the org endpoint. Wildcard entries describe supported prefixes; they are not runnable model ids. An incomplete listing may need a concrete reference confirmed by the deployment operator. Follow the [first-brain guide](../get-started/self-hosted.md) for an example that works with the current runtime.
