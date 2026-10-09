<div v-pre>

# Reasoning function format

The API stores a reasoning function as an `inference` spec. Its source document defines the model, input and output contracts, settings and prompt template. This reference describes that format; [Build your first brain](../tutorials/first-brain.md) provides a guided example using an agent.

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

The Liquid template reads supplied values through `input`. An optional `{% system %}` block provides system instructions. The document must also produce a message outside that block. A function document contains instructions, not model credentials; see [The template](#the-template) for what a template may read and use.

A run invokes the model and records its output and usage. When the function names tools, the model can use them in a bounded loop before answering. An external agent can also pass evidence it collected through its own connections as input.

Changing the document creates a version. A run uses the active latest version and records `spec_version`; the current API does not select an arbitrary historical version to execute. See the [HTTP reference](http.md) for input limits and retry behavior.

## The template

The template reads three variables and nothing else:

| Variable | Value                                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| `input`  | The run's input, a JSON object, with `input.default` merged under it and validated |
| `today`  | The date when the run starts, `YYYY-MM-DD`, in UTC                                 |
| `now`    | The time when the run starts, in ISO 8601, in UTC                                  |

Names the template makes itself, with `assign`, `for`, `increment` or `cycle`, are fine; any other name is rejected when the document is saved. When the input schema lists its `properties` and sets `additionalProperties: false`, `input.<field>` must be one of them. A field the input does not have stops the run with `invalid_input`, naming the field, except in a condition of `if`, `elsif` or `unless` and in the `default` filter, so a template can test a field that may be absent: `{% if input.vip %}…{% endif %}`, `{{ input.nickname | default: "friend" }}`. A list is written as its items without separators and an object as `[object Object]`; write `{{ input.account | json }}` for JSON.

One `{% system %}…{% endsystem %}` block may hold the system instructions. It stands at the top level of the template, outside every other tag, and its tags take no arguments; there is at most one. Everything outside it is the message, sent as one user message, and the template must write something there. An input that holds `{% system %}` or `{% endsystem %}` is written as those characters and never opens or closes the instructions.

The tags are `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment`, `#` and `tablerow`. A function document is one document, so `include`, `render`, `layout` and `block` are not available, and neither is `capture`; use `assign` with `append` instead.

The filters are the plain data and string filters of Liquid: `abs`, `append`, `array_to_sentence_string`, `at_least`, `at_most`, `base64_decode`, `base64_encode`, `capitalize`, `ceil`, `compact`, `concat`, `default`, `divided_by`, `downcase`, `escape`, `escape_once`, `find`, `find_index`, `first`, `floor`, `group_by`, `has`, `join`, `json`, `last`, `lstrip`, `map`, `minus`, `modulo`, `newline_to_br`, `normalize_whitespace`, `number_of_words`, `plus`, `pop`, `prepend`, `push`, `raw`, `reject`, `remove`, `remove_first`, `remove_last`, `replace`, `replace_first`, `replace_last`, `reverse`, `round`, `rstrip`, `shift`, `size`, `slice`, `slugify`, `sort`, `sort_natural`, `split`, `squish`, `strip`, `strip_newlines`, `sum`, `times`, `to_integer`, `truncate`, `truncatewords`, `uniq`, `unshift`, `upcase`, `where` and `xml_escape`. Three more:

| Filter  | What it does                                                                                                   | Example                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `money` | A number, or text that is a decimal number, as US dollars with thousands separators: no cents when it is whole | `{{ 364028 \| money }}` is `$364,028`; `1234.5` is `$1,234.50` |
| `clip`  | Text cut to a number of characters, 400 by default, with an ellipsis appended when it is cut                   | `{{ input.notes \| clip: 200 }}`                               |
| `words` | The number of words in a text                                                                                  | `{% assign n = input.notes \| words %}`                        |

The date filters are left out, since they read the server's clock and time zone, so the same function would render differently on another server; `today` and `now` give the date and the time. So are `sample`, which is random, the digest filters, `strip_html`, the URL encoders, and the filters that evaluate an expression given as text.

| Limit                                       | Value                         | When it is reached              |
| ------------------------------------------- | ----------------------------- | ------------------------------- |
| Length of the template                      | 65,536 characters             | Refused when saved              |
| Names in tags and outputs                   | 1,000                         | Refused when saved              |
| Time to render                              | 200 ms                        | The run ends as `invalid_input` |
| Memory that filters and ranges may charge   | 5,000,000 characters or items | The run ends as `invalid_input` |
| Rendered instructions, and rendered message | 200,000 characters each       | The run ends as `invalid_input` |

## Tools

`tools` lists the tools of the MCP servers configured for the brain that a run may call, each written `server/tool`, or `server/*` for every tool of a server that the operator allows:

```yaml
tools: [graph/search, graph/execute, notes/*]
```

To find the names, call `list_tool_servers` (`GET /v1/orgs/{org}/brains/{brain}/tool-servers`, or the MCP tool of the same name). It lists the servers set up for the brain, each with the tools the operator allows, asking each server for them as a run does, so an agent can write `tools` without being told the names; see [Tool servers](http.md#tool-servers). To learn what a tool answers before naming it, test it with `test_tool_call`, which calls it once as a run would and answers what the run's model would see, for a tool its server marks read-only or the operator marks testable on its entry; see [Testing a tool](http.md#testing-a-tool).

The model receives those tools and can call them before it answers. A run makes at most 25 calls and receives at most 256 KiB of results; a call that would exceed a bound, sends more than 16 KiB of arguments or repeats an earlier call a third time is refused, and the model is told why. Once the calls end, the model answers from what it has, without the tools. Each call appears in the run's history, with the server and tool, the size of its arguments and result, and how it ended.

A run whose function names a tool the brain's servers do not offer, or whose server cannot be reached, is `unavailable` before the model is called. After a tool call, an `unavailable` ending has the kind `tools_unfinished`: a tool may already have changed an external system. The same execution id cannot run that work again and returns `tools_called`. A tool-using run still marked `started` also cannot restart under its id, even before its first recorded call. Inspect its history and any external effects before deliberately starting a new run with a new id. Retrying a successful run returns its recorded result without calling tools again.

Tool access is available in a self-hosted runtime whose operator configures MCP servers; Auto Cloud does not offer it yet. The operator configures the servers with `mcp_servers` and narrows the tools of each with its `allowed`, as the repository's [configuration guide](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/self-host/configuration.md#mcp-servers) describes. See [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## Provider options

`provider_options` holds, under the namespace of a provider, only the options that shape how the model reasons or writes its answer:

| Namespace   | Offered                                                    |
| ----------- | ---------------------------------------------------------- |
| `anthropic` | `thinking`, with only `type`, `budgetTokens` and `display` |
| `openai`    | `textVerbosity`, `reasoningMode`, `logitBias`              |
| `google`    | `thinkingConfig`, `safetySettings`, `threshold`            |

The [engineering reference](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/reference/reasoning-format.md#provider-options) lists the namespaces of the other providers a server may be configured for, and the options each offers. Under a gateway's name a function may set only the request body fields that the gateway's operator allows, and by default none. Any other option is rejected when the document is saved, with the option named, and so are credentials, request headers, tool servers, routing and anything the front matter already sets, such as an effort level, which `config.reasoning` sets. Your agent should use the operation's schema and validation feedback rather than copying a provider's full API request into this field.

The repository's [engineering reference](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/reference/reasoning-format.md) lists the complete format, supported template operations and provider-specific options for contributors.

</div>
