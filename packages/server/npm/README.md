# Auto Runtime

Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them. [Auto Studio](https://studio.on.auto) lets you inspect and manage them.

## Start it

You need Node.js 26.10 or later on macOS or Linux.

```bash
npx @on.auto/runtime
```

The server starts at `http://localhost:5555`, and you sign in through the Auto identity service when your agent connects, with nothing to set. Do not expose it through a tunnel or public proxy. Its MCP endpoint is `http://localhost:5555/mcp`; connect Claude Code with:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

The first time it connects, your agent opens the sign-in page in your browser. For development without signing in, set `LOCAL_MODE=true`: local mode trusts every request on your computer as the local developer, in the org `local`.

## Configure it

Settings are environment variables. The command reads them from the shell and from a `.env` file in the current directory, and the shell wins. To run reasoning functions, give it a model provider's key, such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. Settings that are lists or maps, such as model gateways and tool servers, go in `auto-runtime.yaml` in the current directory; `auto-runtime.example.yaml` in this package shows every one.

The command shows only the server's errors; set `LOG_LEVEL=warn` to see its warnings too, or `LOG_LEVEL=info` to see everything it logs.

The ledger, where playbooks and their runs are kept, is the SQLite file `~/.auto-runtime/ledger.db` unless `LEDGER_FILE` names another file or `DATABASE_URL` names a PostgreSQL database. `PORT` changes the port.

## Commands

```bash
npx @on.auto/runtime                # start the server (also: start)
npx @on.auto/runtime key --org acme # issue an API key for a machine or a pipeline
npx @on.auto/runtime --version
npx @on.auto/runtime --help
```

## Run it in a container

The same release is the image `onauto/runtime` on Docker Hub. See [Run with Docker](https://on.auto/docs/self-host/docker).

## License

Auto Runtime is source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE). [LICENSING.md](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md) explains the terms.
