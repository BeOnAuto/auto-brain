# @beonauto/interaction

Interaction functions: a brain asks a person or a system and takes the answer later. An interaction function is a definition, saved and versioned as every function is; its run renders a request from its input, sends it through the tool of a tool server its document names or leaves it in the brain's inbox, and waits, with nothing in memory, until the request is answered, expires or is cancelled. A function that sends through a tool may also read the replies to its message and take its party's reply as the answer. The answer is the run's output, checked against the answer schema the definition gives. [Decision 0010](../../docs/decisions/0010-interaction-functions.md) records why it is built this way, with its amendment on a function that owns its delivery, [decision 0019](../../docs/decisions/0019-the-answer-shape-of-an-open-request.md) why the listing of open requests shows the answer schema each request recorded, and [decision 0020](../../docs/decisions/0020-replies-through-a-channel.md) how replies are read and taken.

## The document

```markdown
---
description: Send the draft to its owner in the chat and take their approval
to: '{{ input.owner }}'
expires: P2D
deliver:
  server: chat
  tool: post_message
  with:
    channel: '{{ to }}'
    text: '{{ message }}'
  sent:
    conversation: /channel
    id: /ts
replies:
  conversation: '{{ sent.conversation }}/{{ sent.id }}'
  tool: thread_replies
  with:
    channel: '{{ sent.conversation }}'
    ts: '{{ sent.id }}'
    oldest: '{{ since | default: "0" }}'
  read:
    list: /messages
    order: oldest_first
    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }
input:
  schema:
    type: object
    required: [owner, draft]
    properties: { owner: { type: string }, draft: { type: string } }
output:
  schema:
    type: object
    required: [choice]
    properties:
      choice: { type: string, enum: [approve, reject] }
---

Here is the draft: {{ input.draft }}
```

`parseInteractionDocument(source)` reads it with the shared document reader of `@beonauto/definitions/document` (`src/document`). The front matter takes `description`, `to`, a Liquid template that names the party, `from`, one that names the answerer, `expires`, an ISO 8601 duration from one minute to thirty days read by `readDuration` of `@beonauto/workflow-engine/dsl`, `deliver` and `replies`, `input` and `output`, each with a `schema`, and `reply`, the reply rule. Every other key, `model` and `tools` among them, is refused with its line, within the nested blocks too. Without `output.schema` the function is a notification: it takes no answer, and its run succeeds, with the output `{}`, once its delivery lands, at once without `deliver`. The body is the message, a Liquid template. `to`, `from` and the message read `input`, `today` and `now` alone, through an instance of the engine of `@beonauto/definitions/template` with no registrations of its own, and a template that does not compile, reads another name, or a property a closed input schema does not have, is refused with its line.

`src/route` holds the two blocks, written once as effect schemas, `ToolDeliverySchema` and `RepliesSchema`, and `compiledRoute(written, lines, inputSchema)`, which checks them at save: the server and tool names by their shapes, `isServerName` and `isToolName` of `@beonauto/mcp`; every template of `deliver.with`, `replies.conversation`, `replies.with` and `tell.with` against the names its place reads, with no `${`; each pointer of `deliver.sent` and `replies.read` a JSON Pointer that starts with a slash, refused in one sentence; `read.order`; `wait` from `PT5S` to `PT1H`. `replies` needs `deliver`, its `sent` and `output.schema`. Arguments are typed as written (`renderedArguments`): a number, boolean, null, list or object is sent as written with the templates in its strings rendered, a string that is one `{{ expression }}` alone is sent as the value it reads, and any other string is rendered as text, so a structure inside a longer text is refused at save. `routeOf(blocks)` answers what an attempt, a read or a telling works with, `{ kind: 'inbox' }` or `{ kind: 'tool', delivery, replies? }`, and `throughWords` says it, the same sentence the definitions package's `deliveryStarted` says.

The reply rule (`src/replies/reply-rule.ts`, checked by `rule-checks.ts`) maps a top-level string property of the answer to `word`, the first word with the `words` that mean each value, `rest` or `text`; left out, it is derived for an answer whose one required property is a string, and is none otherwise. At most 16 values, 16 words a value, 64 bytes a word.

## A run

`makeInteractionFunctionAdapter({ tools, openRequests, mostOpenRequests })` is the capability (`src/type`, `src/run`). Its prepared definition finishes later, but for a notification without `deliver`, and its longest run is its `expires`, so a workflow step that calls it waits that long and a minute more. It reaches outside while any tool server is configured, `tools.configured`. A run validates its input, checks by name alone that every tool its route names is offered to the brain, `tools.named`, the words of `list_tool_servers` and `unavailable`, kind `tool_not_offered`, otherwise; counts the brain's open requests through `openRequests` and refuses a run past `mostOpenRequests` as `requests_full`. It renders the party, the answerer and the message as text, and the arguments of `deliver` once to check them: an empty party or one with a control character or past 256 bytes, a message past 8 KiB, arguments past 16 KiB as JSON or one that renders no text, end the run `conflict`, kind `unworkable`, with the place in its record. The run then defers, and the deferral's record is the request: `{ to, message, answer_schema, answerer, reply, expires_at, requested_at, deliver, replies }`, the answering fields left out of a notification and the blocks out of a request in the inbox. A run that is cancelled ends `rejected` as `cancelled`, unless an answer a reply brought came first, which settles it.

## The open requests

`openRequests` is a keyed projection of runs the server registers with the ledger (`src/requests/open-requests.ts`), table `open_requests_4`, kept in the transaction of every append. A deferral of an interaction function makes a row: the request's message id, the function and its version, the party, the `delivery` and `replies` it recorded, as JSON text, null for the inbox, the message, whether it takes an answer, the answer schema, the answerer and the reply rule, when it was asked and expires, the attempts made, when the next is due, the delivery's standing, `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, `answered`, once a reply answered it, or `cancelling`, whether it is open, how it ended, the conversation it is read in and what its message was delivered as, the replies refused and told, and two due times while it is open and not `cancelling`: `attempt_due_at`, while it stands `to_deliver` or `retrying`, and `ending_due_at`, the earlier of its expiry and the bound of an attempt in flight, or when it was asked for a row that settles now. Each `delivery_started` moves the next attempt a minute past it; each `delivery_ended` schedules the next attempt, or none once delivered, refused or spent, and keeps `delivered_as` and `replies_in`; `reply_taken` makes the row stand `answered` and `reply_refused` counts; a row that stands `answered`, or a notification that stands `delivered`, is due at once and settled from what was brought back, `settledFromBroughtAnswer`; `run_cancel_requested` makes the row stand `cancelling`, unless what was brought back came first; the run's ending closes the row. Its indexes are by open and time, by party, by function, by conversation, and a partial one across brains on each due time.

## Delivering

`requestsDue({ ledger, tools })` is the due work of the open requests (`src/schedule`): the rows whose next attempt is due when `callsOut` is true, or whose ending is when it is false, so an ending never waits behind an attempt.

- A request past its expiry is settled `rejected`, reason `unanswered`, kind `expired`, as the brain; a notification whose delivery ended undelivered is settled `unanswered`, kind `undelivered`.
- An attempt still in flight a minute after it started is ended as failed, `lost`.
- Otherwise the next attempt (`src/delivery`): the arguments are rendered from the request's record, `deliveryVariablesOf`, so every attempt sends the same; `delivery_started` is recorded through `outboundCallRecorder` of `@beonauto/definitions` with the next number of the run's calls and the fields `tools.startOf` gives, the server, the tool, the size and digest of the arguments and, where the server records content, the arguments; a second host's start is refused and it sends nothing. Then one call, `tools.callOnce`, answers the call whole: not offered, a failed attempt `tool_not_offered`, the request staying open; not opened, `server_failure`; or answered, with the call's fields, and for a result the message the tool names at the `sent` pointers, `delivered_as`, and where replies are read, `replies_in` (`sent-messages.ts`). `delivery_ended` follows, caused by the start.

Attempts follow `attemptSchedule` (`src/schedule/attempt-schedule.ts`): five, the first at once and the others 1, 2, 4 and 8 minutes after the one before, a server's `Retry-After` honoured up to 8 minutes. Arguments past 16 KiB are refused and not tried again. A request whose attempts are spent stays open until it is answered or expires; a notification ends `undelivered`.

## Reading replies

`conversations` is the second projection (`src/conversations`), table `conversations_1`, one row per brain, server, reading tool and conversation key, keyed `server/tool/key`: made or woken by a `delivery_ended` with `replies_in`, its cursor moved by a `replies_read` on the brain's `conversation-calls` stream, and its cadence, `open`, `active_at`, `reads` and `next_read_at`, advanced by its reader through the ledger's `advanceRow`, a compare-and-set on `joined_by`, the id of the delivery that last joined the row, so a read never rests a conversation a request joined while it was in flight. `conversationsDue({ ledger, tools })` is its due work, in the outbound lane. A read advances the row a minute ahead, reads the open requests of the conversation, at most 100, and keeps those that stand `delivered` or `retrying`; with none it rests the row. Otherwise it reads the replies once for all of them, through the reading of the oldest, its recorded `replies`: the arguments rendered over its `to`, its `sent` and the cursor `since`, one `callOnce` of `replies.tool`, the list at `read.list` and each reply at the `each` pointers. A reply belongs to the request whose message it answers, or to the one open request of a conversation, and is refused as `ambiguous` when several are open; a reply from anyone but the answerer is passed over. Its words are mapped by the request's rule and checked against its answer schema (`src/replies`): an answer is `reply_taken`, through `replyRecorder` of `@beonauto/definitions`, and settles the run answered by the brain, `brain:<brain>`, with the reply's identity as evidence; a reply that is no answer, does not fit, or is past 8 KiB is `reply_refused`, ten at most a request, and the party is told how to answer through `tell`, three times at most, a telling recorded as `telling_started` before it is sent and `telling_ended` after. A read that found a reply or failed is one `replies_read`, with the call's fields and the cursor; a read that found nothing writes nothing. The cadence is 5 seconds after a request joins, then 10, 20 and 40, every minute to the eighteenth read and every 5 minutes after, never sooner than `wait`, and as long as a `Retry-After` asks, an hour at most.

## Answering and listing

`answerInteraction` is `answer_interaction`, `POST /runs/{run_id}/answer` under `brain:write`. The answer is checked against the answer schema the request recorded, with pointers under `/answer`, 64 KiB as JSON and 512 levels at most, and settles the run `succeeded`, the answer the output and the record `{ answered_by, claimed_for, answered_at }`, `answered_by` the caller's id, `claimed_for` what the caller says it answers for, at most 256 bytes and never checked. The settlement's key holds the answer's digest, so the same answer again answers the run as it stands and another one is `conflict`, as is an answer to a request that has ended, or one a reply answered first. `listInteractions` is `list_interactions`, `GET /interactions` under `brain:read`: the open requests of the brain, newest first, filtered by `to` and `function`, in pages, each with its `delivery`, its `answer_schema`, and for a request whose function reads replies its `conversation`, `answerer` and `reply_refusals`.

## Words

The capability's run words show the deferral as `interaction_requested`, a type the brain reserves, "A request is waiting for an answer, through the tool post_message of chat, until …", or "… in the inbox …", with the delivery, the party, the answerer where it differs, the size of the message, whether it takes an answer and the expiry, and never the message. An answer is described as the output of any run.

## Bounds

| Bound                                       | Value                                      | When it is reached                                                     |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| The rendered party, and the answerer        | 256 bytes, no control character            | `conflict`, `unworkable`                                               |
| The rendered message                        | 8 KiB                                      | `conflict`, `unworkable`                                               |
| The arguments of a call                     | 16 KiB as JSON                             | `conflict`, `unworkable` at the start; a refused attempt at a delivery |
| What `sent` reads, and the conversation key | 256 bytes each, no control character       | delivered without `delivered_as`; the request takes no reply           |
| A read's answer                             | 64 KiB                                     | a failed read                                                          |
| A reply's words                             | 8 KiB                                      | `reply_refused`, `too_long`                                            |
| Refused replies of a request                | 10 recorded, 3 told                        | no trace, or nobody told                                               |
| Open requests read in a conversation        | 100, oldest first                          | later ones are read for once earlier ones end                          |
| `expires`                                   | 1 minute to 30 days                        | refused at save                                                        |
| An answer                                   | 64 KiB as JSON, 512 levels                 | `invalid_input`                                                        |
| `claimed_for`                               | 256 bytes, event text                      | `invalid_input`                                                        |
| Attempts                                    | 5, at once and after 1, 2, 4 and 8 minutes | a question stays open; a notification ends `undelivered`               |
| Open requests of a brain                    | 10,000 unless the server sets another      | `unavailable`, `requests_full`                                         |

`interactionBounds` holds those of the run.

## Measured

10,000 requests made due at one moment, as a server stopped past their expiry finds them, were all settled `unanswered` as `expired` within 7.5 and 7.8 seconds on SQLite and 8.7 and 8.8 seconds on PostgreSQL, 1,142 to 1,336 a second, at one-minute load averages of 1.6 to 8.2 on 16 cores; workflow timers due in those seconds fired up to 0.55 s late, and those due after them 5 to 63 ms late, as with no request due. The workflow host's README, under its measurements, gives the method, `pnpm --filter @beonauto/server measure`, and every figure; the measurement also has a round of 1,000 conversations read at one moment after a restart, `MEASURE_ONLY=conversations`.

## Testing

`@beonauto/interaction/testing` holds a harness over the in-memory ledger with the projections, the operations of the brain and the due work (`interactionHarness`, and `chatHarness` with the reading), fake tool access over a chat board that posts, lists a thread and takes replies (`fakeTools`), documents of a question, a notification and one read in a thread, and a request asked through the chat.

## Source

`src/document` reads the definition, `src/route` the delivery and the reading, `src/run` renders and defers a request, `src/requests` holds the projection of open requests and the two operations, `src/delivery` the attempt as a recorded call, `src/schedule` the due work and its schedule, `src/conversations` the projection of conversations and the reading, `src/replies` the reply rule, the taking and the tellings, `src/type` the capability, its guide, the public reference page served to agents as `interaction-function`, and its words, and `src/testing` what the tests share.
