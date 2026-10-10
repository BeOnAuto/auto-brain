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
Do not install Node.js, pnpm manages it. Never print secrets or ask for API keys in chat.
Help configure my model provider, then show how to start the server.
```

```bash [Manual]
git clone https://github.com/BeOnAuto/auto-brain.git
cd auto-brain
pnpm install
cp .env.example .env
```

:::

pnpm is the only tool to install. From version 10 it fetches the pnpm and Node.js versions this repository pins and keeps them inside the project, so do not install Node.js for Auto. Without pnpm, run its standalone installer and open a new terminal:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

The install output lists `node 26.10.0` among the dependencies: that is the runtime pnpm fetched for this project. Check the toolchain from inside the checkout:

```bash
pnpm --version
pnpm exec node --version
```

The first prints the pnpm version in the `packageManager` field of `package.json`, `12.8.1` today, and the second the Node.js version in `.nvmrc`, `v26.10.0` today. `node --version` on its own may print another version you installed earlier; Auto does not use it. If you are returning to an existing checkout, keep your existing `.env` file.

::: tip Already have Node.js or pnpm?
pnpm 10 or newer needs nothing: it switches to the pinned version by itself. Upgrade pnpm 9 or older with the installer above. With nvm, fnm or Volta you still do not need Node.js 26; if you switch versions anyway, those tools keep global packages per version, so `pnpm` can disappear from your terminal, while the standalone installer lives outside them.
:::

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

::: tip The only step that needs your own Node.js
Claude Desktop starts the bridge with `npx`, so it needs a current [Node.js LTS release](https://nodejs.org/en/download) with npm on your computer. It is separate from the Node.js pnpm keeps inside the Auto repository, and Claude Code and Codex do not need it.
:::

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

Ask for the result and the recorded run, including its run id. The review should identify the missing measurable goal. A concrete model or configured alias is required; a wildcard such as `provider/*` is not a model to run.

A client that shows MCP prompts also offers the brain's own recipes: `first-brain` makes a first brain this way, and `remember`, `give-tools` and `schedule` make a brain remember what its functions answered, give a function tools and run a workflow on a schedule. The agent reads the same recipes, and the format of each kind of definition, with `get_guide`.

For a second run and a comparison of the results, continue with [Build your first brain](../tutorials/first-brain.md).

## 6. Give your brain tools

A reasoning function can use the tools of an MCP server, such as a search service. You tell Auto about the server in a settings file, `auto-brain.yaml`, and keep the server's key in `.env`.

1. Create `auto-brain.yaml` at the root of the repository, which Git ignores, holding exactly this, with your server's address in place of the example one. It adds the server under `mcp_servers` for the org `local` that a local server uses, with a header that names the environment variable holding its key, written `${NAME}`; every tool of the server is allowed, since its entry leaves `allowed` out:

   ```yaml
   mcp_servers:
     search:
       url: https://search.example.com/mcp
       headers:
         Authorization: Bearer ${SEARCH_API_KEY}
       org: local
   ```

2. Put the key in `.env` as `SEARCH_API_KEY=` followed by the key.
3. Stop the server with Ctrl+C and start it again with `pnpm dev`.
4. Ask your agent to make a function that can use the server:

   ```text
   In the quickstart brain, create a reasoning function that uses the search
   tools to find recent news about a company and sums it up in three points.
   ```

The key never goes in `auto-brain.yaml`; the file only names the variable that holds it. `auto-brain.example.yaml` at the root of the repository shows every other setting, and the repository's [configuration guide](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/self-host/configuration.md#mcp-servers) lists every field of a server.

Your agent can try a tool before a function uses it, to see what it answers. A server that marks its read-only tools needs nothing more for that. For one that marks none, add a `testable` line naming its read-only tools inside its entry in `auto-brain.yaml`, below `org: local` and indented as that line is, then stop the server with Ctrl+C and start it again with `pnpm dev`. For example, if the server is a Constellation gateway, whose read-only tools are search, introspect, validate and dry_run, the end of the entry reads:

```text
    org: local
    testable: [search, introspect, validate, dry_run]
```

## If something does not connect

If the health check fails, check the server terminal for startup errors and confirm that port 8080 is free. If your agent cannot connect but the health check works, check its MCP endpoint, restart the agent session, and confirm it is running on the same computer as Auto.

If `pnpm` is not found after you switched Node.js versions with nvm, fnm or Volta, install it with the standalone installer in step 1, which lives outside those tools, and open a new terminal. If `pnpm install` does not switch to the pinned pnpm, yours is older than 10; upgrade it the same way. To see which Node.js the server runs on, use `pnpm exec node --version` in the checkout rather than `node --version`.

If a reasoning function reports `provider_not_configured`, check the uncommented setting in `.env` and restart Auto. If model discovery is incomplete, use a concrete model reference supported by your configured provider. Do not paste keys into a prompt to fix a connection.

Definitions and run history are saved in the local ledger at `packages/server/.data/ledger.db`. Stop the server with Ctrl+C and restart it with `pnpm dev` when you return. Keep the ledger file if you want to retain your work.

The runtime is in early development and is not ready for production use.

## Hosted brains

Auto Cloud is currently invite-only. [Request an invitation](https://on.auto/request-invite).

You can also host your own brain. See the [self-hosting guide](../self-host.md) for deployment options and support.
