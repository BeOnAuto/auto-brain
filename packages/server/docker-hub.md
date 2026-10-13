# Auto Runtime

Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them. Your coding agent connects over MCP to build and run them, and [Auto Studio](https://studio.on.auto) lets you inspect and manage what it built.

**[Documentation](https://on.auto/docs/)** · **[Self-hosting guides](https://on.auto/docs/self-host)** · **[Source on GitHub](https://github.com/BeOnAuto/runtime)** · **[Release notes](https://github.com/BeOnAuto/runtime/releases)**

## Quick start

A container listens on every interface, so every request needs an API key. Create one, put the entry it prints in a file of settings, and start the server with a volume for its ledger:

```bash
docker run --rm --log-driver none onauto/runtime:latest node packages/identity/src/key-command.ts --org acme
echo 'API_KEYS=[<the API_KEYS entry it printed>]' > auto-runtime.env
docker volume create auto-runtime-data
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
curl http://localhost:5555/health
```

Then connect your agent to `/mcp` with the key, for example in Claude Code:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp --header "Authorization: Bearer <your key>"
```

**[Run with Docker](https://on.auto/docs/self-host/docker)** walks through each step, adds a model provider and has a Compose file that runs the runtime beside PostgreSQL.

## What a deployment needs

| Need           | What to use                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ledger     | A volume on `/data`, where it keeps a SQLite file, or a PostgreSQL database named by `DATABASE_URL`: [Use PostgreSQL](https://on.auto/docs/self-host/postgresql) |
| API keys       | `API_KEYS`, with an entry for each key the key command makes: [Authentication and security](https://on.auto/docs/self-host/security)                             |
| A model        | Anthropic, OpenAI, Google, Amazon Bedrock, Azure OpenAI, Vertex AI or your own gateway: [Model providers and gateways](https://on.auto/docs/self-host/models)    |
| HTTPS          | A reverse proxy or load balancer in front of port `5555`: [Run in production](https://on.auto/docs/self-host/production)                                         |
| Object storage | Optional, an S3-compatible bucket for large content: [Keep content on object storage](https://on.auto/docs/self-host/object-storage)                             |

Every setting is an environment variable; [Configure the runtime](https://on.auto/docs/self-host/configuration) lists them all, with the configuration file for tool servers, gateways and model aliases. [Troubleshooting](https://on.auto/docs/self-host/troubleshooting) covers the common problems.

## Tags

| Tag                      | Points to                              |
| ------------------------ | -------------------------------------- |
| `X.Y.Z`, such as `0.9.1` | Exactly that release; it never changes |
| `X.Y`, such as `0.9`     | The newest release of that line        |
| `latest`                 | The newest release                     |

Every tag is published for `linux/amd64` and `linux/arm64`, built in GitHub Actions with a software bill of materials and provenance. The image runs as the unprivileged user `node`, checks its health at `/health` and stops cleanly on `SIGTERM`.

## Without Docker

`npx @on.auto/runtime` runs the same server on macOS or Linux with Node.js 26.10 or later, in local mode on `http://localhost:5555`. See the [local quick start](https://on.auto/docs/get-started/local).

## License

Source-available under the [Elastic License 2.0](https://github.com/BeOnAuto/runtime/blob/main/LICENSE).
