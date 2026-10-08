# @beonauto/interaction

Interaction functions: a brain asks a person or a system and takes the answer later. An interaction function is a definition, saved and versioned as every function is; its run renders a request from its input, sends it through a channel the operator configured or leaves it in the brain's inbox, and waits, with nothing in memory, until the request is answered, expires or is cancelled. The answer is the run's output, checked against the answer schema the definition gives. [Decision 0010](../../docs/decisions/0010-interaction-functions.md) records why it is built this way.

## The document

```markdown
---
description: Ask the campaign's owner to approve a brief
channel: approvals
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
---

Please review the brief for {{ input.campaign }}.

{{ input.summary }}
```

`parseInteractionDocument(source)` reads it with the shared document reader of `@beonauto/specs/document` (`src/document`). The front matter takes `description`, `channel`, the name of a channel or `inbox`, `to`, a Liquid template that names the party, `expires`, an ISO 8601 duration from one minute to thirty days read by the workflow format's own reader, `readDuration` of `@beonauto/workflow-engine/dsl`, and `input` and `output`, each with a `schema`. `model`, `tools`, `language`, `config` and every other key are refused with their line. Without `output.schema` the function is a notification: it takes no answer, and its run succeeds, with the output `{}`, once its delivery lands, at once for the inbox. The body is the message, a Liquid template. Both templates read `input`, `today` and `now` alone, through an instance of the engine of `@beonauto/specs/template` with no registrations of its own, and a template that does not compile, reads another name, or a property a closed input schema does not have, is refused with its line. The channel is not checked at save: a run through a channel this server does not offer to the brain is `unavailable`, kind `channel_not_offered`.

## Channels

`readChannelSettings(environment, { servers, allowed })` reads `CHANNELS`, JSON in the environment, which the server also writes from the configuration file's `channels`, with the settings machinery `mcp_servers` uses, `@beonauto/config` (`src/channels`). Each key is a channel's name, 1 to 32 lowercase letters, digits and hyphens, starting with a letter; `inbox` is the brain's own and no channel takes it. A channel declares `to`, a regular expression the whole rendered party must match, `org` and optionally `brains`, and its type:

- `webhook`: `url`, https or http on a loopback address; `secret`, the Standard Webhooks secret, `whsec_` and a key of 24 to 64 bytes in base64; optional `headers`, none of those every delivery sets (`content-type`, `content-length`, `host` and the three `webhook-` headers); and `answers: true` when the receiver may answer within the delivery.
- `mcp`: `server`, an entry of `mcp_servers` whose org and brains the channel lies within; `tool`, which `allowed_tools` must allow; and `with`, the call's arguments, each a Liquid template over `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`, written `| json` for a structured value.

A `${…}` reference to the environment is taken in `headers` and `secret` alone, and a value that looks like a credential written out is refused, so a secret never reaches a template or a URL; a `with` template may not hold `${`. Templates are compiled when the settings are read, each rendered once against a sample request so that one that renders a value that is not text is refused there, with the place of every problem and never a value. At most 32 channels. The secrets of every channel are kept for scrubbing.

## A run

`makeInteractionFunctionAdapter({ channels, openRequests, mostOpenRequests })` is the capability (`src/primitive`, `src/run`). Its prepared definition finishes later, but for a notification to the inbox, and its longest run is its `expires`, so a workflow step that calls it waits that long and a minute more. A run validates its input, finds its channel, counts the brain's open requests through `openRequests`, which the server reads from the projection below, and refuses a run past `mostOpenRequests` as `unavailable`, kind `requests_full`. It renders the party and the message as text: a value that is not text, a party that is empty, holds a control character, takes more than 256 bytes or does not match the channel, a message of more than 8 KiB, and for an MCP channel arguments of more than 16 KiB as JSON, end the run `conflict`, kind `unworkable`, with the place in its record. A missing field of the input, or a render past its bounds, is `invalid_input`. The run then defers, and the deferral's record is the request: `{ channel, to, message, answer_schema, expires_at }`, `answer_schema` left out of a notification. A run that is cancelled ends `rejected` as `cancelled` with the kind asked, the default `cancel` of every capability.

## The open requests

`openRequests` is the projection of runs the server registers with the ledger (`src/requests/open-requests.ts`), table `open_requests_1`, kept in the transaction of every append. A deferral of an interaction function makes a row: the request's message id, the function and its version, the party, the channel, the message, whether it takes an answer, when it was asked and expires, the attempts made, when the next is due, the delivery's standing, `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, `answered`, while an answer given within its delivery settles its run, or `cancelling`, once a cancel of its run was asked, whether it is open, how it ended, and `due_at`, the earlier of the expiry and the next attempt while it is open. Each `delivery_started` moves the next attempt a minute past it, the bound of an attempt in flight; each `delivery_ended` schedules the next attempt, or none once delivered, refused or spent, and carries the answer a receiver gave within the delivery, which makes the row stand `answered`; a row that stands `answered`, or a notification that stands `delivered`, is due at once and settled from the last ended delivery, so a server that stopped between the two settles it when it starts; `execution_cancel_requested` makes the row stand `cancelling` and due no more, whatever its attempt in flight does, unless it already stands `answered`, or `delivered` for a notification, since what the delivery gave came first: such a row settles from it, and so does the cancel, `cancelledRequest`, which settles a run from the last ended delivery it carries; the run's ending closes the row. Its indexes are by brain, open and time, by party, by function, and a partial one on `due_at` across brains.

`requestsDue({ ledger, channels, tools, origin, fetch? })` is the due work the server gives the workflow host (`src/schedule`): the rows due by a moment, each performed as follows, and the next due time after one.

- A request past its expiry is settled `rejected`, reason `unanswered`, kind `expired`, as the brain; a notification whose delivery ended undelivered is settled `unanswered`, kind `undelivered`. A settlement refused because the run has just ended does nothing.
- An attempt still in flight a minute after it started, because the server stopped meanwhile, is ended as failed, `lost`.
- Otherwise the next attempt: `delivery_started` is recorded through `outboundCallRecorder` of `@beonauto/specs`, with the next number of the run's calls, so a second host's attempt is refused and sends nothing, and the request's message id as its cause; the delivery is made; `delivery_ended` follows, caused by the start. A channel this server no longer offers ends the attempt failed, `channel_not_offered`, and the request stays open.

Attempts follow `outboundBounds` of `@beonauto/outbound`: five, the first at once and the others 1, 2, 4 and 8 minutes after the one before, a 429's `Retry-After` honoured up to 8 minutes. A request whose attempts are spent stays open until it is answered or expires; a notification ends `undelivered`.

## Deliveries

A webhook delivery (`src/delivery/webhook-delivery.ts`) posts the CloudEvent `interaction_requested` in structured mode, `id` the request's message id, `source` the run under the server's origin, `subject` `interaction/<name>`, and as `data` the origin, the org, the brain, the run id, the function and version, `to`, `message`, `expires_at`, and for a question the answer schema, the URL to answer and the answer token, `answerTokenOf` of `@beonauto/outbound`, the request's message id and an HMAC-SHA256 of it with a key derived from the channel's secret, never stored. It is signed on every attempt with the Standard Webhooks headers, `webhook-id` the request's message id, and sent through `postedOutbound`: HTTPS only but loopback, redirects refused, 240 KiB out, 64 KiB in, 10 s. A 2xx is delivered; 408, 429, 5xx and a connection that fails are failed attempts; any other status and a redirect refuse the delivery, which is not tried again. On a channel with `answers: true`, a 200 whose body is JSON within 64 KiB and fits the answer schema settles the run as answered by `channel:<name>`; a body that is not JSON, is cut or does not fit fails the attempt with that reason. An MCP delivery (`src/delivery/mcp-delivery.ts`) renders the channel's arguments from the request and makes one call through `callOnce` of the server's tool access, the delivery's id the request's message id; a result is delivered, and a tool error, a server failure, a time out or a tool not offered fail the attempt.

## Answering and listing

`defineAnswerInteraction(channels)` is `answer_interaction`, `POST /executions/{execution_id}/answer` under `brain:write`, which authorizes by token: a caller that holds the answer token of a request, over HTTP alone as `Authorization: Request <token>`, has its input checked first, so input that does not fit is `invalid_input` whether or not the brain exists, then the token checked against the secrets of the webhook channels the brain may use before the request is read, then the request it names against the one answered and the token against the secret of the webhook channel that request went through, so a token answers no request in the inbox and none that went through another channel; anything else is `forbidden`, the refusal the dispatcher also gives such a caller for a brain that is missing or retired. The answer is checked against the answer schema the request recorded, with pointers under `/answer`, 64 KiB as JSON and 512 levels at most, and settles the run `succeeded`, the answer the output and the record `{ answered_by, claimed_for, answered_at }`, `answered_by` the caller's id or `channel:<name>`, `claimed_for` what the caller says it answers for, at most 256 bytes and never checked. The settlement's key holds the answer's digest, so the same answer again answers the run as it stands and another one is `conflict`, as is an answer to a request that has ended. `listInteractions` is `list_interactions`, `GET /interactions` under `brain:read`: the open requests of the brain, newest first, filtered by `to` and `function`, in pages.

## Words

The capability's run words show the deferral as `interaction_requested`, a type the brain reserves, "A request is waiting for an answer, through the channel “approvals”, until …", with the channel, the party, the size of the message, whether it takes an answer and the expiry, and never the message; deliveries are told in the words every capability shares, a status as words. An answer is described as the output of any run.

## Bounds

| Bound                            | Value                                                 | When it is reached                                                     |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| The rendered party               | 256 bytes, no control character, matching the channel | `conflict`, `unworkable`                                               |
| The rendered message             | 8 KiB                                                 | `conflict`, `unworkable`                                               |
| The arguments of an MCP delivery | 16 KiB as JSON                                        | `conflict`, `unworkable` at the start; a refused attempt at a delivery |
| `expires`                        | 1 minute to 30 days                                   | refused at save                                                        |
| An answer                        | 64 KiB as JSON, 512 levels                            | `invalid_input`                                                        |
| `claimed_for`                    | 256 bytes, event text                                 | `invalid_input`                                                        |
| Attempts                         | 5, at once and after 1, 2, 4 and 8 minutes            | a question stays open; a notification ends `undelivered`               |
| A webhook's body and response    | 240 KiB out, 64 KiB in, 10 s                          | a failed attempt                                                       |
| Channels                         | 32                                                    | refused at start                                                       |
| Open requests of a brain         | 10,000 unless the server sets another                 | `unavailable`, `requests_full`                                         |

`interactionBounds` holds them.

## Measured

10,000 requests made due at one moment, as a server stopped past their expiry finds them, were all settled `unanswered` as `expired` within 7.5 and 7.8 seconds on SQLite and 8.7 and 8.8 seconds on PostgreSQL, 1,142 to 1,336 a second, at one-minute load averages of 1.6 to 8.2 on 16 cores; workflow timers due in those seconds fired up to 0.55 s late, and those due after them 5 to 63 ms late, as with no request due. The workflow host's README, under its measurements, gives the method, `pnpm --filter @beonauto/server measure`, and every figure.

## Testing

`@beonauto/interaction/testing` holds a harness over the in-memory ledger with the projection, the operations of the brain and the due work (`interactionHarness`), documents of a question and a notification, webhook channels over a fake receiver of `@beonauto/outbound/testing`, and a request asked through one.

## Source

`src/document` reads the definition, `src/channels` the channels, `src/run` renders and defers a request, `src/requests` holds the projection of open requests and the two operations, `src/delivery` the webhook and MCP deliveries, `src/schedule` the due work and its attempts, `src/primitive` the capability, its guide, the public reference page served to agents as `interaction-function`, and its words, and `src/testing` what the tests share.
