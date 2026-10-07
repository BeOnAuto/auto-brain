<div v-pre>

# Interaction function format

The API stores an interaction function as an `interaction` spec. Its source document names a party, a channel and an expiry, and holds the message. A run renders the request from its input, sends it through the channel or leaves it in the brain's inbox, and waits, holding nothing of the server, until the request is answered, expires or is cancelled. The answer, checked against the answer schema the document gives, is the run's output. Use one wherever a brain asks a person or a system and takes the answer later: an approval, a choice, a figure only someone else has, or a notification that needs no answer.

## A function document

The source is Markdown with YAML front matter followed by the message. This example asks a campaign's owner to approve a brief:

<!-- prettier-ignore -->
```markdown
---
description: Ask the campaign's owner to approve a brief
channel: inbox
to: '{{ input.owner }}'
expires: P2D
input:
  schema:
    type: object
    required: [campaign, owner, summary]
    properties:
      campaign: { type: string }
      owner: { type: string }
      summary: { type: string, maxLength: 4000 }
output:
  schema:
    type: object
    required: [choice]
    properties:
      choice: { type: string, enum: [approve, reject] }
      note: { type: string, maxLength: 2000 }
---
Please review the brief for {{ input.campaign }}.

{{ input.summary }}
```

For this document, `create_spec` takes `primitive: "interaction"`, a function `name` such as `approve-brief`, and the document as `source`. `execute_spec` takes the same primitive and name, with `campaign`, `owner` and `summary` in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain. The run answers `status: started` with its `execution_id`, and the request waits in the brain's inbox until it is answered.

## Fields

| Field           | Purpose                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                                                      |
| `channel`       | Required; `inbox`, the brain's own inbox, or the name of a channel the runtime's operator configured                                                                                             |
| `to`            | Required; a template that renders the party the request goes to: an address the channel understands or, for the inbox, a name the brain's readers filter by                                      |
| `expires`       | Required; an ISO 8601 duration from one minute to thirty days, such as `PT4H` or `P2D`, after which a request nobody answered ends                                                               |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                                                |
| `output.schema` | Optional JSON Schema of the answer; the answer must match it and is the run's output. A function without it is a **notification**: it takes no answer and succeeds once its request is delivered |

`model`, `config`, `tools`, `language` and every other field are rejected with their line. The body after the front matter is the message. `to` and the message are Liquid templates that read `input`, `today` and `now` and nothing else, so a template that does not compile, names another value, or names a property the input schema does not allow is rejected with its line when the document is saved. A rendered value is text and is never read again as a template. The saved function has the `media_type` `text/markdown`.

The channel is not checked when the document is saved: a run through a channel the runtime does not offer to the brain is `unavailable` with the kind `channel_not_offered`.

## Channels

The inbox is every brain's own: a request to it waits until a caller who may write to the brain answers it, and `list_interactions` lists it. Any other channel is configured by the operator of a self-hosted runtime, who binds it to an org and optionally to some of its brains, and names a regular expression the whole rendered `to` must match, so a brain reaches no one the operator did not allow. A channel is one of two kinds:

- A **webhook** posts the request to a URL the operator names, signed as [Standard Webhooks](https://www.standardwebhooks.com/) signs a message. The receiver may answer within the delivery, when the operator allows it, or later with the request's answer token.
- An **MCP** channel calls one tool of an MCP server the operator configured, such as a tool that posts a message in a chat, with arguments rendered from the request.

The repository's [configuration guide](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/self-host/configuration.md#channels) describes how an operator writes them.

### What a webhook receives

Each attempt is an HTTP `POST` of the CloudEvent `interaction_requested` in structured mode, `content-type: application/cloudevents+json`. Its `id` is the request's id, the same on every attempt, `source` the run's URL under the runtime's public origin, `subject` `interaction/` and the function's name, and `data` holds the org, the brain, the `execution_id`, the function and its version, `to`, `message`, `expires_at` and, for a question, `answer_schema`, `answer_url` and `answer_token`. The headers `webhook-id`, `webhook-timestamp` and `webhook-signature` sign it: the signature is `v1,` and the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>` under the key the channel's secret holds after its `whsec_` prefix. Verify it before trusting the request.

A `2xx` answer delivers the request. `408`, `429`, a `5xx` answer, a time out and a connection that fails are failed attempts, tried again; any other status, and a redirect, refuse the request, which is not tried again. On a channel that allows answers within the delivery, a `200` whose body is JSON matching the answer schema answers the request at once, and a body that is not JSON, is cut off or does not match is a failed attempt.

### Attempts

A request through a channel is attempted at once, and after a failed attempt again 1, 2, 4 and 8 minutes after the one before, five attempts in all; a `429` with `Retry-After` waits as long as it asks, up to 8 minutes. Each attempt is recorded in the run's history before it is sent, so two servers never make the same attempt. An attempt cut off by a restart counts as failed a minute after it started, and the next one follows, so a receiver may see a request twice and should keep the first by its `webhook-id`. A question whose attempts are spent stays open until someone answers it or it expires; a notification ends `unanswered` as `undelivered`.

## Answering a request

`answer_interaction` answers a request, over MCP or as `POST /v1/orgs/{org}/brains/{brain}/executions/{execution_id}/answer` over HTTP, with the `execution_id` of the interaction function's run, which `list_interactions` shows, and the `answer`:

```json
{ "answer": { "choice": "approve", "note": "Ready to launch." }, "claimed_for": "the campaign team" }
```

A caller that may write to the brain can answer. A system that received the request by webhook can answer instead with its answer token alone, over HTTP, as the header `Authorization: Request <answer_token>`; a token answers only the request it came with.

The answer is checked against the answer schema the request recorded, at most 64 KiB as JSON, and settles the run `succeeded` with the answer as its output. The run's record shows `answered_by`, the caller's id or `channel:` and the channel's name, `answered_at`, and `claimed_for`, whom the caller says it answers for, kept as a claim and never checked. An answer that does not match is `invalid_input`, with a pointer under `/answer` for each problem, and leaves the request open. The same answer again answers the run as it stands; a different answer, or an answer to a request that has ended, is `conflict`.

`list_interactions`, `GET /v1/orgs/{org}/brains/{brain}/interactions` over HTTP, lists the brain's open requests, newest first: the `execution_id`, the function and its version, `to`, the channel, the message, whether it takes an answer, when it was asked and expires, the attempts made and how its delivery stands, `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying` or `undelivered`. `to` keeps the requests to one party and `function` those of one interaction function; it pages with `limit` and `cursor`. Every reader of the brain sees each party and message, as a run's input is seen.

## How a run ends

| Ending                                         | When                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                    | The request was answered, the answer its output; or a notification was delivered, at once for the inbox, with the output `{}`                                                                                  |
| `invalid_input`                                | The input does not match the input schema, or a template names a value the input lacks                                                                                                                         |
| `conflict`, kind `unworkable`                  | `to` rendered empty, as something that is not text, with a control character, longer than 256 bytes or outside the channel's pattern; the message longer than 8 KiB; or an MCP channel's arguments over 16 KiB |
| `unavailable`, kind `channel_not_offered`      | The runtime offers the brain no channel of that name                                                                                                                                                           |
| `unavailable`, kind `requests_full`            | The brain already has as many open requests as the runtime allows, 10,000 unless its operator sets another number                                                                                              |
| `rejected` as `unanswered`, kind `expired`     | Nobody answered the request before it expired                                                                                                                                                                  |
| `rejected` as `unanswered`, kind `undelivered` | Every attempt to deliver a notification failed                                                                                                                                                                 |
| `rejected` as `cancelled`                      | `cancel_execution` cancelled the run, or the workflow that waited for it ran out of time or ended first                                                                                                        |
| `failed`                                       | The runtime itself broke down                                                                                                                                                                                  |

A request that has ended is final for its execution id: answering it is `conflict`, and running the function again starts a new request under a new id.

The run's history shows the request as `interaction_requested`, with the channel, the party, the size of the message, whether it takes an answer and the expiry, never the message, then each delivery attempt as `delivery_started` and `delivery_ended`, with the status a receiver answered in words, and the run's end. An answer is the run's output, which `get_execution` returns and the history does not show.

## Bounds

| Bound                            | Value                                                 | When it is reached                                                       |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| The rendered party               | 256 bytes, no control character, matching the channel | `conflict`, `unworkable`                                                 |
| The rendered message             | 8 KiB                                                 | `conflict`, `unworkable`                                                 |
| The arguments of an MCP delivery | 16 KiB as JSON                                        | `conflict`, `unworkable` at the start                                    |
| `expires`                        | 1 minute to 30 days                                   | Refused when saved                                                       |
| An answer                        | 64 KiB as JSON, 512 levels                            | `invalid_input`                                                          |
| `claimed_for`                    | 256 bytes                                             | `invalid_input`                                                          |
| Attempts                         | 5: at once, then after 1, 2, 4 and 8 minutes          | A question stays open; a notification ends `unanswered` as `undelivered` |
| A webhook's body and its answer  | 240 KiB out, 64 KiB back, 10 seconds                  | A failed attempt                                                         |
| Open requests of a brain         | 10,000 unless the operator sets another number        | `unavailable`, `requests_full`                                           |

## In a workflow

A workflow calls an interaction function as it calls any function, with `call: execute_spec` and `primitive: interaction`. The step waits for the request, as long as the function's `expires` and a minute more, holding nothing of the server, across a restart, and its output is the answer. A request nobody answers raises an error of the [problem type](http.md#responses-and-errors) `https://on.auto/problems/unanswered`, status 410, with the kind `expired` or, for a notification, `undelivered`. No retry policy matches it unless it names that type, so a workflow handles an unanswered request only on purpose, and a workflow that does not catch it ends `rejected` as `unanswered` with the same kind. When the step runs out of time, or the workflow ends first, the request is cancelled.

This workflow asks for the approval and, when nobody answers in time, records that the brief went unapproved:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaigns
  name: brief-approval
  version: '1.0.0'
  summary: Asks the campaign's owner to approve a brief, and notes when nobody answered.
input:
  schema:
    document:
      type: object
      required: [campaign, owner, summary]
do:
  - approval:
      try:
        - ask:
            call: execute_spec
            with:
              primitive: interaction
              name: approve-brief
              input: '${ . }'
      catch:
        errors:
          with: { type: https://on.auto/problems/unanswered, kind: expired }
        do:
          - unapproved: { set: { choice: unanswered } }
```

The run ends `succeeded` with the answer, such as `{"choice": "approve"}`, as its output, or with `{"choice": "unanswered"}` when the request expired. `list_interactions` shows the request while it waits, under the `execution_id` of the interaction function's run.

`send_execution_event` remains for events a waiting workflow listens for that are not the answer to a question.

## Availability

Interaction functions are available in a self-hosted runtime, through the inbox and the channels its operator configures. See [Functions and availability](../concepts/functions.md#availability).

</div>
