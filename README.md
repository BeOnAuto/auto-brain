# auto-brain

The source-available runtime for business brains, built and used through your agent.

Save the way your team reviews a campaign brief as a reason function. An agent supplies a brief, runs the review and reads the recorded result. The definition stays in the brain, ready for the next brief or another authorized colleague.

[![CI](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml) [![License: ELv2](https://img.shields.io/badge/license-ELv2-blue?style=flat-square)](LICENSING.md)

## Quick start

1. Add your Auto Cloud workspace's MCP URL and authentication details to your agent. Need access? [Contact Auto](https://on.auto/contact-us). See [connection instructions](https://on.auto/docs/get-started/cloud) or [request a Studio invite](https://on.auto/request-invite).
2. Paste this into your connected agent:

```text
Create a brain named Quickstart with id quickstart, or reuse it if it exists.
List the available models and ask me to choose a concrete model or alias.
In that brain, create a reason function called check-brief. It accepts a brief
as text and checks for an audience, a budget and a measurable goal.
If the function already exists, show it to me before making changes.
Run the saved function on: "Promote our reporting tool to finance teams
with a USD 5,000 budget."
Show the result and read back the recorded run, including its execution id.
```

The review should flag the missing measurable goal. You now have a saved function you can reuse and a recorded run to inspect. Your connection needs permission to create brains, create and run functions, and use a model. If model discovery is unavailable, ask your workspace administrator for a concrete model reference.

For a second run and a comparison of the results, continue with [Build your first brain](https://on.auto/docs/tutorials/first-brain).

<details>
<summary>Run locally instead</summary>

Install [pnpm](https://pnpm.io/installation), then:

```bash
git clone https://github.com/BeOnAuto/auto-brain.git
cd auto-brain
pnpm install
cp .env.example .env
```

In `.env`, set a model provider key such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. Keep it out of your agent conversation. pnpm uses the Node and pnpm versions pinned by this repository.

```bash
pnpm dev
```

Keep that terminal open. The runtime listens at `http://localhost:8080`; in another terminal, `curl http://localhost:8080/health` should return `{"status":"ok"}`.

Add `http://localhost:8080/mcp` as a streamable HTTP connection in an agent running on your computer, without an authentication header, then use the prompt above. A hosted agent cannot reach your laptop's localhost. This local mode has no authentication: do not expose it through a tunnel or public proxy. The same server runs workflows, with nothing else to start.

See [local setup and client configurations](docs/engineering/get-started/self-hosted.md) for details. For a deployment your team operates, see [Self-hosting](https://on.auto/docs/self-host).

</details>

## Documentation and help

[Auto documentation](https://on.auto/docs/) covers the platform and this runtime together. Start with [Brains and methods](https://on.auto/docs/concepts/brains) and [Workflows and runs](https://on.auto/docs/concepts/workflows); consult [Functions and availability](https://on.auto/docs/concepts/functions) for current capabilities, or the [MCP reference](https://on.auto/docs/reference/mcp) when integrating an agent.

The source-available runtime is in early development and is not ready for production use; [availability](https://on.auto/docs/concepts/functions#availability) describes the current scope.

Coming soon: tool access inside reason functions through a shared catalog and MCP gateway, with direct tool lists and bounded tool-call loops. Today, the external agent calls Auto over MCP and passes evidence into the function; the function does not inherit the agent's tools. See [Tool access](https://on.auto/docs/concepts/functions#tool-access-inside-a-reason-function).

For bugs and questions, [open an issue](https://github.com/BeOnAuto/auto-brain/issues/new/choose). Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Contribute

Runtime code and its documentation live here. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and checks, and [Documentation contributions](docs/contributing/documentation.md) to preview or improve a guide. Documentation pull requests can be reviewed without the private website repository or service credentials.

## License

auto-brain is source-available under the [Elastic License 2.0](LICENSE). [LICENSING.md](LICENSING.md) explains the terms, including restrictions on offering it as a hosted or managed service. Contributions follow the [CLA](CLA.md) and [Code of Conduct](CODE_OF_CONDUCT.md).
