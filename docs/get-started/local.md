---
description: Start Auto Runtime on your computer and connect Claude Code, Claude Desktop or Codex.
---

# Quick start: connect your agent

Start Auto Runtime on your computer and connect Claude Code, Claude Desktop or Codex. At the end, your agent can talk to Auto, and you are ready to build your first playbook.

## Before you start

**If your team already runs Auto on a server**, you don't need this page. Ask whoever runs it for its address, such as `https://auto.example.com/mcp`, and connect your agent as [step 4](#connect-your-agent) shows, with that address in place of the local one the step uses. Sign in with your Auto account when asked. Then go straight to [Build your first playbook](../tutorials/first-playbook.md).

This page uses a terminal, the window where you type commands (the Terminal app on a Mac). If your agent can run commands, as Claude Code and Codex can, it can do most of the work for you, so they are the easiest agents to start with. Claude Desktop works too, but its setup means editing a settings file by hand. You can also ask someone technical to do this page with you. After this page, the two beginner tutorials need nothing but messages to your agent; some later tasks, such as adding a tool server, need a terminal or whoever runs Auto.

Each step below says who does it: your agent, or you. Setup plus [Build your first playbook](../tutorials/first-playbook.md) takes you from nothing to your first result.

This setup is for macOS or Linux. You need [Node.js](https://nodejs.org/en/download) 26.10 or later, which comes with `npx`, and an agent such as Claude Code or Codex on the same computer. The Claude Desktop instructions below are for macOS. To check your Node.js version, run `node --version` in a terminal: it should print `v26.10.0` or higher. If it prints an older version or "command not found", install Node.js from its website first, or let the Agent prompt in step 1 do it.

Auto uses an AI model of its own when it runs your work, so you also need an API key from a model provider. An API key is a secret code you create on the provider's website: [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys) or [Google](https://aistudio.google.com/app/apikey). Copy it somewhere safe; you add it to Auto in step 2. Your agent's subscription does not supply the server's model credentials, so Auto needs this key even if you already pay for your agent.

On your own computer you don't need an Auto account: Auto runs in local mode, where nobody signs in and everything you make belongs to an organization called `local`.

## 1. Install Auto Runtime

**Your agent can do this step.** If your agent can run terminal commands, paste the Agent prompt into it and let it guide you. Otherwise, or if you prefer, type the commands on the Manual tab into a terminal.

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

The manual commands make a folder called `auto-runtime`, move into it, and download Auto the first time. The last command prints Auto's version number, which tells you the download worked. Auto reads its settings from the folder you start it in, so use this folder every time.

## 2. Add your model provider key

**You do the last part of this step**, so that your key never passes through your agent. Auto reads your key from a small settings file called `.env` in the `auto-runtime` folder. If you used the Agent prompt, your agent has created the file and told you where to paste your key. Otherwise, open the file in the terminal's built-in text editor, from the `auto-runtime` folder:

```bash
nano .env
```

Type one line for your provider, such as `ANTHROPIC_API_KEY=` followed by your key with no spaces. To save and close, press Ctrl+O, then Enter, then Ctrl+X. The line uses one of these names:

| Provider  | Setting                        |
| --------- | ------------------------------ |
| Anthropic | `ANTHROPIC_API_KEY`            |
| OpenAI    | `OPENAI_API_KEY`               |
| Google    | `GOOGLE_GENERATIVE_AI_API_KEY` |

Only Auto reads the key. Never paste it into a conversation with your agent. Your provider bills you for the model calls Auto makes.

For Amazon Bedrock, Azure OpenAI, Google Vertex AI or your own gateway, see [Set up a model provider](../self-host/models.md).

## 3. Start Auto

**You do this step.** In the `auto-runtime` folder, run:

```bash
npx @on.auto/runtime
```

Auto keeps running for as long as this window stays open, so leave it open. Start Auto in its own terminal window like this, rather than asking your agent to start it inside the agent's session: Auto would stop when that session ends. When it is ready, it shows its address, `http://localhost:5555`, a link that opens [Auto Studio](https://studio.on.auto) in your browser, and the commands that connect Claude Code and Codex.

To check that it is ready, open `http://localhost:5555` in your browser: a page says Auto Runtime is running.

Your agent connects to Auto at `http://localhost:5555/mcp`. (MCP is the standard way AI agents connect to other software.) Auto runs in [local mode](../self-host/security.md#local-mode): it accepts connections only from your own computer and treats every one as you, with no sign-in. Do not expose it through a tunnel or public proxy, since anyone who reached it that way would act as you; to share Auto with your team, [run it on a server](../self-host.md) instead.

## 4. Connect your agent {#connect-your-agent}

**You do this step**, once. Open a second terminal window, go to the `auto-runtime` folder (`cd auto-runtime`), and follow the steps for your agent there, leaving Auto running in the first window. (If you are connecting to your team's Auto on a server, skip the folder and use their address instead.) Your agent must run on the same computer as Auto: a web-based agent that runs in the cloud cannot reach Auto on your computer.

Your agent connects without signing in, and the playbooks you make belong to the organization `local`.

### Claude Code

In a terminal, run:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

Start Claude Code and type `/mcp`. It should list `auto-runtime` as connected. [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) has more detail.

### Codex

In a terminal, run:

```bash
codex mcp add auto-runtime --url http://localhost:5555/mcp
```

Start a new Codex session and type `/mcp` to check the connection. The [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) has more detail.

### Claude Desktop

Claude Desktop takes a few more steps, because you add Auto to its settings file by hand.

::: details Set up Claude Desktop

Claude Desktop's built-in connectors can't reach Auto on your computer: its remote connector runs from Anthropic's servers. Instead, add Auto to its settings file.

Open **Settings → Developer → Edit Config** and add the `auto-runtime` entry under `mcpServers`, keeping any entries already there:

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

This uses a small third-party bridge, [mcp-remote](https://github.com/punkpeye/mcp-remote), to link Claude Desktop to Auto. Quit and reopen Claude Desktop, with Auto still running, and check that the Auto tools appear in a new conversation.

If Claude Desktop says it cannot find `npx`, set `command` to the full path of `npx` on your computer (the command `which npx` prints it). The [local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) covers more problems.

:::

## 5. Check the connection

**You ask, your agent answers.** Send your agent this message:

```text
Use the auto-runtime connection to list my playbooks and the models this server can use.
```

Your agent should say that you have no playbooks yet, and list the AI models Auto can use with your key. If no models appear, see [If something does not connect](#if-something-does-not-connect).

You're connected. From now on you work by talking to your agent.

## Next: your first playbook

Continue with [Build your first playbook](../tutorials/first-playbook.md). In a few messages to your agent, you teach Auto how your team reviews a campaign brief and use it on two briefs. That is your first result.

After that, [Build your first workflow](../tutorials/first-workflow.md) adds a step that asks a person to approve the review. If you would rather have your agent lead the way, ask it: "Read Auto's first-playbook guide and help me create my first playbook." To let a function look things up while it runs, see [Give a function tools](../guides/tools.md).

## If something does not connect

- **The check page shows nothing.** Look in the Auto window for an error message. Another program may already be using Auto's port, 5555. To check from a terminal instead, run `curl http://localhost:5555/health`; a running Auto answers `{"status":"ok"}`.
- **Auto is running but your agent can't connect.** Check the address `http://localhost:5555/mcp`, restart your agent, and make sure it runs on this computer.
- **Your agent says no model provider is set up (`provider_not_configured`).** Check the key in `.env` in the `auto-runtime` folder, then stop Auto and start it again. Never paste a key into a conversation.
- **No models appear when your agent checks.** Auto didn't find your key. Check the line in `.env`, then stop Auto and start it again.
- **Some model names end in `*`, such as `anthropic/*`.** Each stands for a family of models, and it is not a model to run. Your agent picks a specific model from the list when it needs one.
- **You want to sign in with your Auto account instead,** so your work belongs to your organization rather than `local`. Add `PUBLIC_URL=http://localhost:5555` to `.env` and start Auto again. The first time your agent connects, Auto's sign-in page opens in your browser; if you have no account, you can create one there. Playbooks made in local mode stay in `local` and don't show while you are signed in. [Let people sign in](../self-host/security.md#let-people-sign-in) explains the rules.

[Troubleshooting](../self-host/troubleshooting.md) covers these and other problems.

Your work is saved in a file in your home folder, `~/.auto-runtime/ledger.db`, whichever folder you start Auto in. To stop Auto, press Ctrl+C in its window; to start it again, run `npx @on.auto/runtime` in the `auto-runtime` folder. Keep that file to keep your work.

## Run it for your team

To run Auto on a server for your team, see the [self-hosting guide](../self-host.md) for deployment options and support.
