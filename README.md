# auto-brain

The source-available runtime for business brains, built and used through your agent.

Save the way your team reviews a campaign brief as a reason function. An agent supplies a brief, runs the review and reads the recorded result. The definition stays in the brain, ready for the next brief or another authorized colleague.

[![CI](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml) [![License: ELv2](https://img.shields.io/badge/license-ELv2-blue?style=flat-square)](LICENSING.md)

## Get started

1. [Connect your agent to Auto Cloud](https://on.auto/docs/get-started/cloud). You need an Auto account, permission to create a brain and create and run a function, and a model available to your workspace.
2. [Build your first brain](https://on.auto/docs/tutorials/first-brain). Save a campaign-review function, try two briefs and compare their recorded runs.

Auto Cloud hosts the runtime. For a deployment your team operates, see [Self-hosting](https://on.auto/docs/self-host).

Coming soon: tool access inside reason functions through a shared catalog and MCP gateway, with direct tool lists and bounded tool-call loops. Today, the external agent calls Auto over MCP and passes evidence into the function; the function does not inherit the agent's tools. See [Tool access](https://on.auto/docs/concepts/functions#tool-access-inside-a-reason-function).

## Documentation and help

[Auto documentation](https://on.auto/docs/) covers the platform and this runtime together. Start with [Brains and methods](https://on.auto/docs/concepts/brains); consult [Functions and availability](https://on.auto/docs/concepts/functions) for current capabilities, or the [MCP reference](https://on.auto/docs/reference/mcp) when integrating an agent.

The source-available runtime is in early development and is not ready for production use; [availability](https://on.auto/docs/concepts/functions#availability) describes the current scope.

For bugs and questions, [open an issue](https://github.com/BeOnAuto/auto-brain/issues/new/choose). Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Contribute

Runtime code and its documentation live here. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and checks, and [Documentation contributions](docs/contributing/documentation.md) to preview or improve a guide. Documentation pull requests can be reviewed without the private website repository or service credentials.

## License

auto-brain is source-available under the [Elastic License 2.0](LICENSE). [LICENSING.md](LICENSING.md) explains the terms, including restrictions on offering it as a hosted or managed service. Contributions follow the [CLA](CLA.md) and [Code of Conduct](CODE_OF_CONDUCT.md).
