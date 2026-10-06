# Build your first brain with your agent

This guide uses a local checkout. You need a terminal to start the runtime, but your agent creates the definitions and runs them through MCP. The runtime is in early development and is not ready for production use.

You need [pnpm](https://pnpm.io/installation), for example from `curl -fsSL https://get.pnpm.io/install.sh | sh -`. In this repository pnpm switches itself to the version the repository pins, 12.8.1, and runs every script on the Node.js it pins, 26.10.0, which it downloads on the first `pnpm install`; the Node.js on your machine does not matter.

```bash
git clone https://github.com/BeOnAuto/auto-brain.git
cd auto-brain
pnpm install
cp .env.example .env
```

Before `pnpm dev`, uncomment one line of `.env` and put your key in it:

| Provider                     | In `.env`                                 | A model to name               |
| ---------------------------- | ----------------------------------------- | ----------------------------- |
| Anthropic                    | `ANTHROPIC_API_KEY=<your key>`            | `anthropic/claude-sonnet-4-5` |
| OpenAI                       | `OPENAI_API_KEY=<your key>`               | `openai/gpt-5`                |
| Google                       | `GOOGLE_GENERATIVE_AI_API_KEY=<your key>` | `google/gemini-2.5-flash`     |
| An OpenAI-compatible gateway | `GATEWAY_API_KEY=<your key>`              | `gateway/<model>`             |

A gateway also needs its address, which goes in the [configuration file](../self-host/configuration.md):

```bash
cp auto-brain.example.yaml auto-brain.yaml
```

Then put your gateway's `base_url` in `auto-brain.yaml`. Start the configured runtime:

```sh
pnpm dev
```

`pnpm dev` starts the server, which runs workflows itself, in [local mode](../self-host/security.md#local-mode), on `http://localhost:8080`. Once it is up, it says so:

```text
10:42:44.130 INFO  [dev] auto-brain is ready
  server     http://localhost:8080
  models     anthropic
  MCP        http://localhost:8080/mcp
```

Next, connect your AI assistant to `http://localhost:8080/mcp`. Local mode needs no key:

- **Claude Code**: `claude mcp add --transport http auto-brain http://localhost:8080/mcp`
- **Cursor**, in `.cursor/mcp.json` or `~/.cursor/mcp.json`: `{"mcpServers": {"auto-brain": {"url": "http://localhost:8080/mcp"}}}`
- **VS Code**, in `.vscode/mcp.json`: `{"servers": {"auto-brain": {"type": "http", "url": "http://localhost:8080/mcp"}}}`
- **Other assistants** take the entry under [Connecting an agent over MCP](../reference/mcp.md), without its header.

You can begin by asking: "Given what you know about my work, suggest a small reusable function we could build in Auto. Tell me what information it needs before creating anything." For a concrete first run, follow the example below.

Name a model your provider serves, such as `anthropic/claude-sonnet-4-5` or `gateway/<a model id your gateway serves>`. The assistant learns which providers the server has, but not which models your account offers.

1. "Create a brain called support for our customer support team."
2. "In support, create a reasoning function that classifies a support ticket by category (billing, bug, account or other) and urgency (low, normal or high), answering in JSON. Configure its prompt to follow those criteria, and run it on: I was charged twice for March and nobody has answered for three days."
3. "How many tokens did that run use, and what exactly was sent to the model?"
4. "Change the prompt so that anything about money is billing and at least normal urgency, then run it on the same ticket again."
5. "Build a workflow that classifies a ticket and, only when it is urgent, drafts a two-sentence note for the on-call lead. Run it on that ticket and on: How do I export my invoices as CSV?"
6. "Create a demonstration workflow that waits for an approval event. Run it and send it a sample approval. Do not issue a refund or contact anyone."

Each tool's description explains the supported definition format. This example drafts outputs and tests a waiting workflow; it does not install a support-system connector or execute a refund.

To reuse your first function, ask another question in a new conversation connected to the same runtime. For a shared deployment, use a persistent container and scoped API keys. Local mode is only for your own machine; do not expose it to colleagues through a proxy. See [Run in a container](../self-host/container.md) and [Authentication and security](../self-host/security.md).

To try it without an assistant, `scripts/try-inference.sh http://localhost:8080 <provider/model>` and `scripts/try-workflows.sh http://localhost:8080 <provider/model>` run a reasoning function and a workflow over HTTP and print what happened. [How it works](../reference/http-tutorial.md) walks through the same steps.
