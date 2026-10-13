---
description: Start Auto Runtime on your computer and connect Claude Code, Claude Desktop or Codex.
---

# Quick start: connect your agent

Run Auto Runtime on your computer and use your agent to create a reusable function.

::: info Auto Cloud
Auto Cloud hosting is coming soon. [Request an invitation](https://on.auto/request-invite).
:::

This setup is for macOS or Linux. You need [Node.js](https://nodejs.org/en/download) 26.10 or later, which comes with `npx`, and an agent such as Claude Code or Codex on the same computer. The Claude Desktop instructions below are for macOS. To run a reasoning function, Auto also needs access to a model provider. Your agent's subscription does not supply the server's model credentials.

## 1. Install Auto Runtime

Copy the Agent prompt into a coding agent with terminal access, or use the Manual tab to install it yourself.

::: code-group

```text [Agent]
Install Auto Runtime with npx @on.auto/runtime, as https://on.auto/docs/get-started/local describes.
Ask before installing prerequisites such as Node.js 26.10; keep existing files and .env.
Never print secrets or ask for API keys in chat.
Help configure my model provider in .env, then show how to start the server.
```

```bash [Manual]
mkdir auto-runtime
cd auto-runtime
npx @on.auto/runtime --version
```

:::

`npx` downloads Auto Runtime the first time and keeps it in its cache, so nothing is cloned or built. Auto Runtime reads its settings from the directory you start it in, so use the same directory each time. If you are returning to it, keep your existing `.env` file.

## 2. Configure a model provider

Create a file named `.env` in that directory, holding one provider setting with your API key, such as `ANTHROPIC_API_KEY=` followed by the key:

| Provider  | Setting                        |
| --------- | ------------------------------ |
| Anthropic | `ANTHROPIC_API_KEY`            |
| OpenAI    | `OPENAI_API_KEY`               |
| Google    | `GOOGLE_GENERATIVE_AI_API_KEY` |

Use a key with access to the model you want to run. Auto reads it on the server; you do not need to paste it into the agent's conversation or its MCP configuration. A setting exported in your shell works too, and wins over `.env`. Model calls may incur charges from your provider.

For another provider or an OpenAI-compatible model gateway, see the repository's [model configuration guide](https://github.com/BeOnAuto/runtime/blob/main/docs/engineering/self-host/models.md).

## 3. Start the server

```bash
npx @on.auto/runtime
```

It shows the address of the server, `http://localhost:5555`, its MCP endpoint, a link that opens [Auto Studio](https://studio.on.auto) on it, the model providers it found and where it keeps your work. Keep this terminal open. In a second terminal, check that the server is ready:

```bash
curl http://localhost:5555/health
```

You should see `{"status":"ok"}`. The MCP endpoint is `http://localhost:5555/mcp`.

This local mode needs no authentication header and trusts callers on your computer. Do not expose it through a tunnel or public proxy. The server runs reasoning functions, such as the example below, computation functions and workflows.

## 4. Connect your agent {#connect-your-agent}

Choose your client below. The agent must reach the server on your computer; a web-based connector running in the cloud cannot reach your `localhost`.

### Claude Code

In a terminal, add the HTTP connection:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

Start Claude Code in that directory, then use `/mcp` to check that `auto-runtime` is connected. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) for connection scopes and tool permissions.

### Codex

Add the HTTP connection:

```bash
codex mcp add auto-runtime --url http://localhost:5555/mcp
```

Start a new Codex session. Use `/mcp` in the CLI to check the connection, or `codex mcp list` to inspect the saved configuration. See [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Desktop

Claude Desktop needs a local MCP connection for this setup. Its remote connector runs from Anthropic's servers, so entering `http://localhost:5555/mcp` there will not reach Auto on your computer.

Desktop runs the bridge below with `npx`, from the Node.js you installed for Auto Runtime.

In Claude Desktop, open **Settings → Developer → Edit Config**. Add the `auto-runtime` entry to `mcpServers`, keeping any existing entries:

```json
{
  "mcpServers": {
    "auto-runtime": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.14.3", "http://localhost:5555/mcp", "--allow-http", "--transport", "http-only"]
    }
  }
}
```

This uses the third-party [mcp-remote](https://github.com/punkpeye/mcp-remote) bridge to connect Desktop's local stdio transport to Auto's HTTP endpoint. The first launch downloads the pinned bridge package. Quit and reopen Claude Desktop, keeping Auto running, then check that its Auto tools are available in a new conversation.

If Desktop cannot find `npx`, use the full path to your `npx` executable as `command`. See the [local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) for configuration paths and troubleshooting. Do not put this local URL in Claude's [remote connector settings](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 5. Create your first function

Ask your connected agent:

```text
Use the auto-runtime connection to list my playbooks and available models.
Help me choose a concrete model or alias my configured provider supports.
Create a playbook named Quickstart with id quickstart, or reuse it if it exists.
In that playbook, prepare a reasoning function called check-brief. It accepts a
brief as text and checks for an audience, a budget and a measurable goal.
Show me the definition before saving it; do not overwrite an existing one.
```

After you approve the definition, ask it to run the saved function on:

```text
Promote our reporting tool to finance teams with a USD 5,000 budget.
```

Ask for the result and the recorded run, including its run id. The review should identify the missing measurable goal. A concrete model or configured alias is required; a wildcard such as `provider/*` is not a model to run.

A client that shows MCP prompts also offers the playbook's own recipes: `first-playbook` makes a first playbook this way, and `remember`, `give-tools` and `schedule` make a playbook remember what its functions answered, give a function tools and run a workflow on a schedule. The agent reads the same recipes, and the format of each kind of definition, with `get_guide`.

For a second run and a comparison of the results, continue with [Build your first playbook](../tutorials/first-playbook.md).

## 6. Give your playbook tools

A reasoning function can use the tools of a tool server, such as the MCP server of a search service. You tell Auto about the server in a settings file, `auto-runtime.yaml`, and keep the server's key in `.env`.

1. Create `auto-runtime.yaml` in the directory you start Auto Runtime in, holding exactly this, with your server's address in place of the example one. It adds the server under `tool_servers` for the org `local` that a local server uses, with a header that names the environment variable holding its key, written `${NAME}`; every tool of the server is allowed, since its entry leaves `allowed` out:

   ```yaml
   tool_servers:
     search:
       url: https://search.example.com/mcp
       headers:
         Authorization: Bearer ${SEARCH_API_KEY}
       org: local
   ```

2. Put the key in `.env` as `SEARCH_API_KEY=` followed by the key.
3. Stop the server with Ctrl+C and start it again with `npx @on.auto/runtime`.
4. Ask your agent to make a function that can use the server:

   ```text
   In the quickstart playbook, create a reasoning function that uses the search
   tools to find recent news about a company and sums it up in three points.
   ```

The key never goes in `auto-runtime.yaml`; the file only names the variable that holds it. [`auto-runtime.example.yaml`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.example.yaml) shows every other setting, and the repository's [configuration guide](https://github.com/BeOnAuto/runtime/blob/main/docs/engineering/self-host/configuration.md#tool-servers) lists every field of a server, an HTTP API with an OpenAPI document among them.

Your agent can try a tool before a function uses it, to see what it answers: it finds the tool with search and calls it once with execute, and the playbook records the call in its history. A tool its server does not mark read-only may change something, so your agent should ask you before it calls one.

## If something does not connect

If the health check fails, check the server terminal for startup errors and confirm that port 5555 is free. If your agent cannot connect but the health check works, check its MCP endpoint, restart the agent session, and confirm it is running on the same computer as Auto.

If a reasoning function reports `provider_not_configured`, check the setting in `.env` in the directory you started Auto in, and restart Auto. If model discovery is incomplete, use a concrete model reference supported by your configured provider. Do not paste keys into a prompt to fix a connection.

Definitions and run history are saved in the local ledger at `~/.auto-runtime/ledger.db`, whichever directory you start Auto Runtime in. Stop the server with Ctrl+C and start it again with `npx @on.auto/runtime` when you return. Keep the ledger file if you want to retain your work.

The runtime is in early development and is not ready for production use.

## Hosted playbooks

Auto Cloud is coming soon. [Request an invitation](https://on.auto/request-invite).

You can also host your own playbook. See the [self-hosting guide](../self-host.md) for deployment options and support.
