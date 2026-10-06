<div v-pre>

# Reason function format

The API stores a reason function as an `inference` spec. Its source document defines the model, input and output contracts, settings and prompt template. This reference describes that format; [Build your first brain](../tutorials/first-brain.md) provides a guided example using an agent.

## A function document

The source is Markdown with YAML front matter followed by a Liquid prompt template. This example reviews a campaign brief. Replace the model reference with a concrete id from [`list_models`](mcp.md#model-information), or one confirmed by your workspace administrator.

```markdown
---
description: Reviews a campaign brief against the team's criteria
model: anthropic/claude-sonnet-4-5
config:
  max_output_tokens: 800
input:
  schema:
    type: object
    properties:
      brief: { type: string }
      criteria: { type: string }
    required: [brief, criteria]
---

{% system %}Review the brief using the supplied criteria. Identify missing evidence. Do not invent facts.{% endsystem %}
Brief: {{ input.brief }}
Criteria: {{ input.criteria }}
```

For this document, `create_spec` takes `primitive: "inference"`, a function `name` and the document as `source`. `execute_spec` takes the same primitive and name, with `brief` and `criteria` in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain.

## Fields

| Field                                                                        | Purpose                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `description`                                                                | Optional explanation, 1 to 1,000 characters                            |
| `model`                                                                      | Required model reference in `provider/model` form                      |
| `config.max_output_tokens`                                                   | Output limit from 1 to 64,000; defaults to 1,024                       |
| `config.temperature`, `config.top_p`, `config.seed`, `config.stop_sequences` | Optional sampling settings supported by the selected provider          |
| `config.reasoning`                                                           | Optional effort: `none`, `minimal`, `low`, `medium`, `high` or `xhigh` |
| `input.schema`                                                               | Optional JSON Schema with an object root                               |
| `input.default`                                                              | Optional defaults merged underneath the supplied input                 |
| `output.format`                                                              | `text` by default, or `json`                                           |
| `output.schema`                                                              | Required for JSON output; disallowed for text output                   |
| `provider_options`                                                           | Optional reviewed provider-specific settings                           |
| `tools`                                                                      | Optional list of the tools of MCP servers the run may call             |

Unknown fields are rejected. Creation and updates validate the document and report issues under `/source`, with line numbers and JSON pointers where available. Warnings can identify schema features a provider may not enforce while generating an answer; the runtime still validates the returned JSON.

## Prompts and results

The Liquid template reads supplied values through `input`. An optional `{% system %}` block provides system instructions. The document must also produce a message outside that block. A function document contains instructions, not model credentials.

A run makes a model invocation and records its output and usage. An external agent can pass evidence it collected through its own connections as input.

Changing the document creates a version. A run uses the active latest version and records `spec_version`; the current API does not select an arbitrary historical version to execute. See the [HTTP reference](http.md) for input limits and retry behavior.

## Tools

`tools` lists the tools of the MCP servers configured for the brain that a run may call, each written `server/tool`, or `server/*` for every tool of a server that the operator allows:

```yaml
tools: [graph/search, graph/execute, notes/*]
```

The model receives those tools and can call them before it answers. A run makes at most 25 calls and receives at most 256 KiB of results; a call that would exceed a bound, sends more than 16 KiB of arguments or repeats an earlier call a third time is refused, and the model is told why. Once the calls end, the model answers from what it has, without the tools. Each call appears in the run's history, with the server and tool, the size of its arguments and result, and how it ended.

A run whose function names a tool the brain's servers do not offer, or whose server cannot be reached, is `unavailable` before the model is called. Once a run has called a tool, a run that cannot finish is `unavailable` with words that say what it called, and the same execution id is not run again: start a new run. Tool access is available in a self-hosted runtime whose operator configures MCP servers; Auto Cloud does not offer it yet. See [Tool access inside a reason function](../concepts/functions.md#tool-access-inside-a-reason-function).

## Provider options

The runtime accepts a reviewed subset of provider options. It rejects credentials, request headers, tool-server configuration and unsupported keys in function documents. Your agent should use the operation's schema and validation feedback rather than copying a provider's full API request into this field.

The repository's [engineering reference](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/reference/reasoning-format.md) lists the complete format, supported template operations and provider-specific options for contributors.

</div>
