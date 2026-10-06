---
description: Start Auto Brain on your computer and connect Claude Code, Claude Desktop or Codex.
---

# Quick start: connect your agent

Run Auto Brain on your computer and use your agent to create a reusable function.

::: info Auto Cloud
Our hosted option is currently invite-only. [Request an invitation](https://on.auto/request-invite).
:::

This setup is for macOS or Linux. You need [Git](https://git-scm.com/downloads), [pnpm](https://pnpm.io/installation), and an agent such as Claude Code or Codex on the same computer. The Claude Desktop instructions below are for macOS. To run a reasoning function, Auto also needs access to a model provider. Your agent's subscription does not supply the server's model credentials.

## 1. Install Auto Brain

Copy the Agent prompt into a coding agent with terminal access, or use the Manual tab to install it yourself.

::: code-group

```text [Agent]
Install https://github.com/BeOnAuto/auto-brain using its setup guide.
Ask before installing prerequisites; keep existing files and .env.
Use pinned versions. Never print secrets or ask for API keys in chat.
Help configure my model provider, then show how to start the server.
```

```bash [Manual]
git clone https://github.com/BeOnAuto/auto-brain.git
cd auto-brain
pnpm install
cp .env.example .env
```

:::

pnpm uses the Node and pnpm versions pinned by the repository, downloading them when needed. If you are returning to an existing checkout, keep your existing `.env` file.

## 2. Configure a model provider

Open `.env`, uncomment one provider setting and replace its placeholder with your API key:

| Provider  | Setting                        |
| --------- | ------------------------------ |
| Anthropic | `ANTHROPIC_API_KEY`            |
| OpenAI    | `OPENAI_API_KEY`               |
| Google    | `GOOGLE_GENERATIVE_AI_API_KEY` |

Use a key with access to the model you want to run. Auto reads it on the server; you do not need to paste it into the agent's conversation or its MCP configuration. Model calls may incur charges from your provider.

For another provider or an OpenAI-compatible model gateway, see the repository's [model configuration guide](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/self-host/models.md).

## 3. Start the server

```bash
pnpm dev
```

Keep this terminal open. In a second terminal, check that the server is ready:

```bash
curl http://localhost:8080/health
```

You should see `{"status":"ok"}`. The MCP endpoint is `http://localhost:8080/mcp`.

This local mode needs no authentication header and trusts callers on your computer. Do not expose it through a tunnel or public proxy. The server runs reasoning functions, such as the example below, computation functions and workflows.

## 4. Connect your agent {#connect-your-agent}

Choose your client below. The agent must reach the server on your computer; a web-based connector running in the cloud cannot reach your `localhost`.

### Claude Code

In a terminal, add the HTTP connection:

```bash
claude mcp add --transport http auto-brain http://localhost:8080/mcp
```

Start Claude Code in that directory, then use `/mcp` to check that `auto-brain` is connected. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) for connection scopes and tool permissions.

### Codex

Add the HTTP connection:

```bash
codex mcp add auto-brain --url http://localhost:8080/mcp
```

Start a new Codex session. Use `/mcp` in the CLI to check the connection, or `codex mcp list` to inspect the saved configuration. See [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Desktop

Claude Desktop needs a local MCP connection for this setup. Its remote connector runs from Anthropic's servers, so entering `http://localhost:8080/mcp` there will not reach Auto on your computer.

Install a current [Node.js LTS release](https://nodejs.org/en/download) with npm, so Desktop can run `npx`. This is separate from the Node version pnpm manages inside the Auto repository.

In Claude Desktop, open **Settings → Developer → Edit Config**. Add the `auto-brain` entry to `mcpServers`, keeping any existing entries:

```json
{
  "mcpServers": {
    "auto-brain": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.14.3", "http://localhost:8080/mcp", "--allow-http", "--transport", "http-only"]
    }
  }
}
```

This uses the third-party [mcp-remote](https://github.com/punkpeye/mcp-remote) bridge to connect Desktop's local stdio transport to Auto's HTTP endpoint. The first launch downloads the pinned bridge package. Quit and reopen Claude Desktop, keeping Auto running, then check that its Auto tools are available in a new conversation.

If Desktop cannot find `npx`, use the full path to your `npx` executable as `command`. See the [local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) for configuration paths and troubleshooting. Do not put this local URL in Claude's [remote connector settings](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 5. Create your first function

Ask your connected agent:

```text
Use the auto-brain connection to list my brains and available models.
Help me choose a concrete model or alias my configured provider supports.
Create a brain named Quickstart with id quickstart, or reuse it if it exists.
In that brain, prepare a reasoning function called check-brief. It accepts a
brief as text and checks for an audience, a budget and a measurable goal.
Show me the definition before saving it; do not overwrite an existing one.
```

After you approve the definition, ask it to run the saved function on:

```text
Promote our reporting tool to finance teams with a USD 5,000 budget.
```

Ask for the result and the recorded run, including its execution id. The review should identify the missing measurable goal. A concrete model or configured alias is required; a wildcard such as `provider/*` is not a model to run.

For a second run and a comparison of the results, continue with [Build your first brain](../tutorials/first-brain.md).

## If something does not connect

If the health check fails, check the server terminal for startup errors and confirm that port 8080 is free. If your agent cannot connect but the health check works, check its MCP endpoint, restart the agent session, and confirm it is running on the same computer as Auto.

If a reasoning function reports `provider_not_configured`, check the uncommented setting in `.env` and restart Auto. If model discovery is incomplete, use a concrete model reference supported by your configured provider. Do not paste keys into a prompt to fix a connection.

Definitions and run history are saved in the local ledger at `packages/server/.data/ledger.db`. Stop the server with Ctrl+C and restart it with `pnpm dev` when you return. Keep the ledger file if you want to retain your work.

The runtime is in early development and is not ready for production use.

## Hosted brains

Auto Cloud is currently invite-only. [Request an invitation](https://on.auto/request-invite).

You can also host your own brain. See the [self-hosting guide](../self-host.md) for deployment options and support.
