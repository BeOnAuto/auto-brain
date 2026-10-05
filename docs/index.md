---
description: Understand business brains, build a first reason function, and find guides and API reference.
---

# Auto documentation

Auto stores business methods as reusable functions that an agent can run. A brain holds those definitions and their recorded runs. Your agent is the interface for creating and using them; the management interface provides operational visibility and controls.

## Understand the model

Start with [Brains and methods](concepts/brains.md) to see how a business responsibility becomes a brain. [Functions and availability](concepts/functions.md) explains the types of work it can perform and their current status. [Workflows and runs](concepts/workflows.md) covers coordination, while [History and Dream](concepts/history-and-dream.md) explains recorded work and the proposed use of that history.

## Build something

[Connect your agent to Auto Cloud](https://on.auto/docs/get-started/cloud), then follow [Build your first brain](tutorials/first-brain.md). The tutorial creates a campaign-brief review function and compares two recorded runs. [Build your first workflow](tutorials/first-workflow.md) then runs that review twice around a revision the workflow waits for.

To bring graph data into an existing function, follow [Use Auto with Apollo](integrations/apollo.md).

## Look up a detail

The references cover [MCP tools and results](reference/mcp.md), the [reason function document format](reference/reasoning-format.md), the [workflow document format](reference/workflow-format.md), and [HTTP operations](reference/http.md).

[Self-hosting](self-host.md) explains deployment responsibilities and support for teams operating their own runtime.

## Contribute

These pages are maintained with the public runtime and published within [on.auto/docs](https://on.auto/docs/), alongside Cloud guides owned by the website team. This standalone build is a contributor preview. [Documentation contributions](contributing/documentation.md) explains how to edit, check and publish a change.
