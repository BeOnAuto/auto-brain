# Runtime engineering guides

These repository-only guides describe the development checkout for contributors and operators. They are excluded from the public documentation build and search. Start with the [local quick start](../get-started/local.md) to try Auto. For production deployment support, see [Self-hosting](../self-host.md).

Workflows run in the server itself, on the workflow engine of `@beonauto/workflow-engine` hosted in Node by `@beonauto/workflow-host`, and are kept in the ledger's database. The adapters for Auto's cloud hosting are not built yet. These guides describe the setup and the limitations of the current code.

## Run and operate the checkout

- [Local quickstart](get-started/self-hosted.md)
- [Install from source](self-host/installation.md)
- [Container deployment](self-host/container.md)
- [Configuration](self-host/configuration.md)
- [Models and gateways](self-host/models.md)
- [Authentication and security](self-host/security.md)
- [Workflow operations](self-host/workflows.md)
- [Troubleshooting](self-host/troubleshooting.md)

## Implementation reference

- [HTTP API](reference/http.md) and [HTTP walkthrough](reference/http-tutorial.md)
- [MCP transport and tool behavior](reference/mcp.md)
- [Complete reasoning function format](reference/reasoning-format.md)
- [Workflow format and execution](reference/workflow-format.md)

Keep these notes accurate when changing the runtime. Publish the relevant user-facing behavior separately in the public guides. Package READMEs retain code entry points and test instructions; architecture decisions live in [decisions](../decisions/README.md).
