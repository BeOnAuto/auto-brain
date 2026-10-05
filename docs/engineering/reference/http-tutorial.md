# Create and run a brain over HTTP

Start the runtime using the [local quick start](../get-started/self-hosted.md). These examples use local mode and need `curl` and `jq`. Use an API key and your own org id outside local mode.

Everything an assistant does over MCP is also an operation over HTTP. In local mode every org is open; the brains an assistant makes on `/mcp` belong to the org `local`, so these commands use it. Create a brain, list the org's brains, and read one back:

```bash
curl --request POST http://localhost:8080/v1/orgs/local/brains \
  --header 'content-type: application/json' \
  --data '{"brain":"sales","name":"Sales","description":"Answers questions about the pipeline"}'
curl http://localhost:8080/v1/orgs/local/brains
curl http://localhost:8080/v1/orgs/local/brains/sales
```

`PUT /v1/orgs/local/brains/sales` replaces the name and the description, and `POST /v1/orgs/local/brains/sales/retire` retires the brain for good.

A brain does its work through specs: named, versioned documents, each for one primitive. An inference spec calls a language model, with the key from your `.env`. Write a spec, `greeting.md`: YAML front matter that names the model, then a Liquid template that renders the prompt from the input.

```markdown
---
description: Greets a customer
model: anthropic/claude-sonnet-4-5
input:
  schema: { type: object, properties: { name: { type: string } }, required: [name] }
---

{% system %}You write one warm sentence.{% endsystem %}
Greet {{ input.name }}, whose order shipped today, {{ today }}.
```

Create the spec in the brain, execute it, and read the execution back with the record of the call: the rendered prompt, the model, the tokens it used and how long it took.

```bash
jq --null-input --rawfile source greeting.md '{name: "greeting", source: $source}' |
  curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/inference \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/inference/greeting/execute \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
curl http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

A document with a problem is rejected with every problem and its line. An input that does not match the schema is rejected before any model is called. A provider that is not configured answers `503`; its missing settings are reported to the operator, not exposed to the caller. [Reason function format](reasoning-format.md) describes the document and recorded result. [HTTP API](http.md) describes the operations. An assistant does the same over [MCP](mcp.md), where tool descriptions explain the supported definition formats.

A workflow spec runs steps that execute other specs, branch, wait and listen for events, durably, on the Temporal that `pnpm dev` runs. Write `welcome.yaml`, a workflow that executes the greeting above, then waits for the customer's reply:

```yaml
document:
  dsl: '1.0.3'
  namespace: acme
  name: welcome
  version: '1.0.0'
  summary: Greets a customer, then waits for their reply.
do:
  - greet:
      call: execute_spec
      with:
        primitive: inference
        name: greeting
        input:
          name: ${ .name }
      output:
        as: '${ { greeting: . } }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '${ $input + { reply: .[0] } }'
```

Create it, execute it, and send it the event it waits for:

```bash
jq --null-input --rawfile source welcome.yaml '{name: "welcome", source: $source}' |
  curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/orchestration \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/orchestration/welcome/execute \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b"}'
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/events \
  --header 'content-type: application/json' \
  --data '{"event":{"type":"com.acme.customer.replied","data":"Thank you!"}}'
curl http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b
```

Executing answers `started` at once; the execution reads `started` until the workflow ends, and then `succeeded` with `{"greeting": ..., "reply": "Thank you!"}`. The greeting has its own recorded run under an id derived from the workflow's run, made by the caller who started the workflow. The public [workflow format](../../reference/workflow-format.md) describes the supported steps, and the repository-only [workflow execution notes](workflow-format.md) how they run.
