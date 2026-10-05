# Runtime engineering guides

These repository-only guides describe the development checkout for contributors and operators. They are excluded from the public documentation build and search. Start with the [local quick start](../get-started/local.md) to try Auto. For production deployment support, see [Self-hosting](../self-host.md).

The current checkout still contains the Temporal-backed orchestration implementation. The replacement workflow engine is under development. The extracted DSL and engine contracts do not mean that the replacement execution engine is ready. These guides preserve the setup and limitations of the current code while the transition proceeds.

## Run and operate the checkout

- [Local quickstart](get-started/self-hosted.md)
- [Install from source](self-host/installation.md)
- [Container deployment](self-host/container.md)
- [Configuration](self-host/configuration.md)
- [Models and gateways](self-host/models.md)
- [Authentication and security](self-host/security.md)
- [Current workflow operations](self-host/temporal.md)
- [Troubleshooting](self-host/troubleshooting.md)

## Implementation reference

- [HTTP API](reference/http.md) and [HTTP walkthrough](reference/http-tutorial.md)
- [MCP transport and tool behavior](reference/mcp.md)
- [Complete reason function format](reference/reasoning-format.md)
- [Current workflow format and execution](reference/workflow-format.md)

Keep these notes accurate when changing the runtime. Publish the relevant user-facing behavior separately in the public guides. Package READMEs retain code entry points and test instructions; architecture decisions live in [decisions](../decisions/README.md).
