<div v-pre>

# Interaction function format

The API stores an interaction function as a definition of the type `interaction`. A function takes one of three shapes. One that asks a system names, in `call`, a tool of a tool server and answers at once with what the tool answered. One that asks a person names a party and an expiry and holds the message, which a run renders from its input and either sends through the tool of a tool server the document names in `deliver` or, for a function that names none, leaves in the brain's inbox; the run then waits, holding nothing of the server, until the request is answered, expires or is cancelled, and the answer, checked against the answer schema the document gives, is its output. Use a call wherever a brain needs what a system answers now, such as the replies of a thread, and a request wherever it asks a person and takes the answer later: an approval, a choice, a figure only someone else has, or a notification that needs no answer.

## A function document

The source is Markdown with YAML front matter followed by the message. This example asks a campaign's owner to approve a brief:

<!-- prettier-ignore -->
```markdown
---
description: Ask the campaign's owner to approve a brief
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

For this document, `create_definition` takes `type: "interaction"`, a function `name` such as `approve-brief`, and the document as `source`. `run_definition` takes the same type and name, with `campaign`, `owner` and `summary` in the `input` object. Both operations also require the brain id unless the MCP connection is scoped to that brain. The run answers `status: started` with its `run_id`, and the request waits in the brain's inbox until it is answered, since the function names no `deliver`.

## Asking a system

A function that asks a system names, in `call`, a tool of a tool server the brain may use and the arguments the call takes, and answers at once with what the tool answered: its run makes one call, takes the part of the answer `read` points at, checks it against `output.schema` and ends with it as its output. It makes no request and sends no message, so it has no `to`, `expires`, `deliver`, `replies` or body, and it asks no model. Write a call from what the tool answers, not from memory:

1. Call `list_tool_servers` to see the tool servers this brain may use, the tools each offers, the `input_schema` each takes and whether its server marks it read-only.
2. Test the tool with `test_tool_call`, with the arguments its `input_schema` takes, and read its `answer`: that is the document `read` points into, the tool's structured content, else the first text block parsed as JSON, else that text. A tool that lists the replies of a thread in a chat answers the replies and a cursor to the next page, for example.
3. Write `call` with `server` and `tool` as `list_tool_servers` names them, `with`, the arguments, and `read`, a JSON Pointer to the part of the answer the function answers with, such as `/messages`; leave `read` out to answer with the whole answer. Write `output.schema`, the shape that part has in the test's answer.
4. Show the person the whole document and save it with `create_definition`, `type` interaction, once they agree. `run_definition` runs it and answers its output at once.

The arguments in `with` are the tool's own, named as its `input_schema` names them, and may nest. A number, `true`, `false`, `null`, or a list or an object of them, is sent as written. A text is a Liquid template that reads `input`, `today` and `now`, and is sent as the text it renders; a text that is one `{{ }}` and nothing else sends the value it reads as that value is, so `'{{ input.limit }}'` sends a number when the input's `limit` is a number. `read` names a place in the answer and nothing more: shape what a call answers in the workflow, with `output.as`, or with a computation function.

A run whose tool server this brain may not use, whose tool the operator of this server does not allow or the server does not list, or whose tool server cannot be reached, ends `unavailable` before anything is sent, in the words of `list_tool_servers`, and can be run again. Once the call is sent it is in the run's history. When the tool server fails on it, or the tool answers an error, a tool its server marks read-only ends the run `unavailable` as `tools_unfinished`, status 503, which a workflow may try again; any other tool may have changed something, so the run ends `conflict` as `effect_unknown`, status 409, and a workflow tries it again only where its `catch` names that kind. A run whose arguments the tool refused, or whose answer holds nothing where `read` points or does not match `output.schema`, ends `conflict` as `unworkable`, which trying again does not change. A tool that pages answers one page for each run: answer with the part that holds both the items and the cursor, and have the workflow call again with the cursor while there is one.

## Sending through a tool

A function sends its request through a tool of a tool server the brain may use by naming the tool in `deliver`, with the arguments the call takes; it needs nothing set up beyond the tool server itself. A function without `deliver` waits in the brain's inbox. Write a delivery from what the tool answers, not from memory:

1. Call `list_tool_servers` to see the servers this brain may use and the tools each offers.
2. Test the tool that sends with `test_tool_call`, with the arguments its `input_schema` takes, and read its answer: that is the document `deliver.sent` points into, with JSON Pointers, to where the conversation the message landed in and the identity of the message are named. A chat's tool that posts a message answers the conversation it posted in and the message's timestamp or id.
3. When the person answers where the message reached them, test the tool that reads what came since a point, and write `replies`: the `conversation` the brain reads by, the tool and its arguments over `sent` and the cursor `since`, the pointers of `read` to the list of replies and, within each, its id, its sender, its words and the message it answers, the floor `wait` of the cadence, and `tell`, how the party is told when a reply was not an answer. The `reply` rule maps the reply's words to the answer.
4. Write `deliver` with `server`, `tool`, `with` and `sent`, show the person the whole document, and save it with `create_definition`, `type` interaction, once they agree. A run refuses a server this brain may not use or a tool its operator does not allow, in the words of `list_tool_servers`.

The arguments of `deliver.with`, `replies.with` and `tell.with` are typed as written: a number, boolean, null, list or object is sent as written, with the templates inside its strings rendered; a string that is exactly one `{{ expression }}` is sent as the value the expression reads, so a number stays a number and an object an object, and `'{{ answer_schema }}'` sends the schema itself; any other string is rendered as text, with `| json` to embed a structured value in it. The templates of `deliver.with` read `input`, `today` and `now` as the message does, and the request's `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`; `today` and `now` are the request's own moment, so every attempt sends the same arguments. `to` is the party the request goes to, which the templates may use as the tool's address or not. A template holds no `${`, since a document is never filled from the environment.

This function sends a draft to its owner in a chat and takes their approval from the replies in the thread of the message:

<!-- prettier-ignore -->
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
    limit: 15
  read:
    list: /messages
    order: oldest_first
    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }
  wait: PT1M
  tell:
    with:
      channel: '{{ sent.conversation }}'
      thread_ts: '{{ sent.id }}'
      text: '{{ message }}'
input:
  schema:
    type: object
    required: [owner, draft]
    properties:
      owner: { type: string }
      draft: { type: string, maxLength: 4000 }
output:
  schema:
    type: object
    required: [choice]
    properties:
      choice: { type: string, enum: [approve, reject] }
      note: { type: string, maxLength: 2000 }
---
Here is the draft:

{{ input.draft }}

Reply **approve** or **reject**, with a note if you reject.
```

Every name in it is the chat's own, learned by testing its two tools: what the sending tool takes, where its answer names the message, and what the reading tool lists. The `channel` argument is the chat's word for a conversation, which the brain passes on as it passes any argument.

### Attempts

A request sent through a tool is attempted at once, and after a failed attempt again 1, 2, 4 and 8 minutes after the one before, five attempts in all; a server that answers with `Retry-After` is waited for as long as it asks, up to 8 minutes. Each attempt is one call of the tool, recorded in the run's history before it is sent, with the size and digest of its arguments, so two servers never make the same attempt, and its end records what the tool answered. A tool error, a server failure, no answer within 30 seconds and a connection not opened within 10 seconds are failed attempts, tried again; arguments past 16 KiB are refused and not tried again. A tool the server no longer offers to the brain fails the attempt, and the request stays open, to be answered through the inbox. An attempt cut off by a restart counts as failed a minute after it started, and the next one follows, so a tool may be called twice for one request. A question whose attempts are spent stays open until someone answers it or it expires; a notification ends `unanswered` as `undelivered`.

## Fields

| Field           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | Optional explanation, 1 to 1,000 characters                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `call`          | The tool the function asks: `server` and `tool` as `list_tool_servers` names them, `with`, the arguments, and `read`, a JSON Pointer to the part of the answer it answers with; with it, `output.schema` is required and `to`, `expires`, `deliver`, `replies`, `from`, `reply` and the body are refused, as the section on asking a system says                                                                                                                                                                |
| `to`            | Required without `call`, refused with it; a template that renders the party the request goes to, a name the brain's readers filter by, which a delivery's templates may use as the tool's address                                                                                                                                                                                                                                                                                                               |
| `from`          | Optional; a template, as `to` is, rendering the party whose reply counts, the answerer; `to` when left out. A request sent to a room names the person here                                                                                                                                                                                                                                                                                                                                                      |
| `expires`       | Required without `call`, refused with it; an ISO 8601 duration from one minute to thirty days, such as `PT4H` or `P2D`, after which a request nobody answered ends                                                                                                                                                                                                                                                                                                                                              |
| `deliver`       | The tool the request is sent through: `server` and `tool` as `list_tool_servers` names them; `with`, the arguments of the call, typed as written, a number, boolean, null, list or object sent as written with the templates in its strings rendered, a string that is one `{{ expression }}` sent as the value it reads, and any other string rendered as text; and `sent`, two JSON Pointers into the tool's answer, to the conversation and the message's identity. Left out, the request waits in the inbox |
| `replies`       | Only with `deliver`, its `sent` and `output.schema`: how the replies to the message are read, `conversation`, `tool`, `with`, `read`, `wait` and `tell`, as the section on sending through a tool says                                                                                                                                                                                                                                                                                                          |
| `input.schema`  | Optional JSON Schema of the input                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `output.schema` | Optional JSON Schema of the answer; the answer must match it and is the run's output. A function without it is a **notification**: it takes no answer and succeeds once its request is delivered                                                                                                                                                                                                                                                                                                                |
| `reply`         | Optional, only with `output.schema`: the reply rule, which maps a top-level string property of the answer to where in a reply its value comes from, `word`, the first word, with the `words` that mean each value, `rest`, what follows it, or `text`, the whole reply. Left out, an answer whose one required property is a string takes that property from the first word, with an `enum`, or from the whole reply, without one                                                                               |

`model`, `config`, `tools`, `language` and every other field are rejected with their line. The body after the front matter is the message. `to`, `from` and the message are Liquid templates that read `input`, `today` and `now` and nothing else, so a template that does not compile, names another value, or names a property the input schema does not allow is rejected with its line when the document is saved. A rendered value is text and is never read again as a template. The saved function has the `media_type` `text/markdown`.

The templates of a call and a delivery are checked the same way when the document is saved, each against the names its place reads: `call.with` and `deliver.with` those above; `replies.conversation` `to`, `sent.conversation` and `sent.id`; `replies.with` those and `conversation` and `since`; `tell.with` `to`, `sent.conversation`, `sent.id` and `message`. A structure inside a longer text is rejected with its line. Each pointer of `call.read`, `deliver.sent` and `replies.read` is a JSON Pointer such as `/messages`: it starts with a slash, writes `~` as `~0` and a slash within a name as `~1`. `read.order` is `oldest_first` or `newest_first`, and `wait` lies between `PT5S` and `PT1H`, `PT5S` when left out. The server and the tool are not checked when the document is saved: a run whose server does not serve the brain, or whose tool its operator does not allow, is `unavailable` with the kind `tool_not_offered`.

## Answering a request

`answer_interaction` answers a request, over MCP or as `POST /v1/orgs/{org}/brains/{brain}/runs/{run_id}/answer` over HTTP, with the `run_id` of the interaction function's run, which `list_interactions` shows, and the `answer`:

```json
{ "answer": { "choice": "approve", "note": "Ready to launch." }, "claimed_for": "the campaign team" }
```

When the person answers a request in a conversation, by approving, rejecting, asking for changes or in other words, the agent they talk to answers it with `answer_interaction`, on the request's `run_id`, with the answer in the shape of the request's `answer_schema`, which `list_interactions` shows beside that `run_id`: the function's `output.schema` as it stood when the request was asked, which `get_definition` no longer shows once the function has changed. For the document above, the person's "approve" is `{ "choice": "approve" }`; for a function whose answer has a `decision` of `approve`, `revise` or `skip` and an optional `note`, it is `{ "decision": "approve" }`. This holds wherever the request reached the person, in the inbox or through a tool such as a chat's. Running the function or its workflow again answers nothing: it makes a new request and leaves the first open until it expires, while the run that waits for it goes on waiting.

A caller that may write to the brain can answer. The answer is checked against the answer schema the request recorded, at most 64 KiB as JSON, and settles the run `succeeded` with the answer as its output. The run's record shows `answered_by`, the caller's id, `answered_at`, and `claimed_for`, whom the caller says it answers for, kept as a claim and never checked. An answer that does not match is `invalid_input`, with a pointer under `/answer` for each problem, and leaves the request open. The same answer again answers the run as it stands; a different answer, or an answer to a request that has ended, is `conflict`.

`list_interactions`, `GET /v1/orgs/{org}/brains/{brain}/interactions` over HTTP, lists the brain's open requests, newest first: the `run_id`, the function and its version, `to`, the `delivery`, the tool the request is sent through or `null` for the inbox, the message, whether it takes an answer, when it was asked and expires, the attempts made and how its delivery stands, `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, `answered`, while a reply that answered it settles its run, or `cancelling`, once a cancel of its run was asked. `to` keeps the requests to one party and `function` those of one interaction function; it pages with `limit` and `cursor`. Every reader of the brain sees each party and message, as a run's input is seen.

Each listed request also shows its `answer_schema`, the JSON Schema an answer is checked against, as the request recorded it, or `null` for a notification.

### Answering by reply

Where a function reads replies, the person answers by replying to the message the brain sent, in the chat it reached them in: the brain reads the conversation's new replies while the request stands open, every few seconds at first and every five minutes at most, never more often than the function's `wait`, and takes a reply from the party the request names as its answerer, `from`, or `to` when the function gives no `from`. The reply's first word must be one of the answer's values, or a word the function's `reply` rule lists for one, and what follows is kept as the note the rule names; a reply the rule cannot read is refused, and the party is told how to answer where the function writes `tell`, three times at most. A reply in a thread answers the question the thread began with; a reply outside a thread answers the conversation's one open request, and is refused when several are open. The answer settles the run as any answer does, with `answered_by` the brain, `brain:` and its id, and `reply` the identity of the message that answered; a reply taken once is never taken twice, and a request already answered takes no further reply. A reply from anyone but the answerer is passed over and kept nowhere. `list_interactions` shows for each such request the `conversation` the brain reads, its `answerer` and how many of its replies were refused. A request whose function reads no replies, or has no reply rule, is answered with `answer_interaction` alone.

## How a run ends

| Ending                                         | When                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                                    | The request was answered, the answer its output; or a notification was delivered, at once without `deliver`, with the output `{}`                                                                                                                                                         |
| `succeeded`                                    | A function with `call`: the tool answered and the part `read` points at matched `output.schema`; it is the output                                                                                                                                                                         |
| `invalid_input`                                | The input does not match the input schema, or a template names a value the input lacks                                                                                                                                                                                                    |
| `conflict`, kind `unworkable`                  | `to` or `from` rendered empty, as something that is not text, with a control character or longer than 256 bytes; the message longer than 8 KiB; or the arguments of `deliver` over 16 KiB, or one that renders no text                                                                    |
| `conflict`, kind `unworkable`                  | A function with `call`: an argument renders a structure among text or the arguments pass 16 KiB; the tool refused the arguments; the answer has nothing to read, nothing where `read` points, more there than a run may record, 1 MiB with its record, or a value `output.schema` refuses |
| `unavailable`, kind `tool_not_offered`         | A server the function names does not serve the brain, or its operator does not allow a tool the function names; for a function with `call`, also a tool the server does not list; nothing was sent                                                                                        |
| `unavailable`, kind `mcp_server_failed`        | A function with `call`: the tool server could not be reached or refused the connection or the listing of its tools; nothing was sent                                                                                                                                                      |
| `unavailable`, kind `tools_unfinished`         | A function with `call` whose tool its server marks read-only: the call was sent and its server failed on it or did not answer within 30 seconds, `because` `server_failed`, or its tool answered an error, `because` `tool_error`; trying again is safe                                   |
| `conflict`, kind `effect_unknown`              | The same for any other tool, which may have changed something: whether it did is not known, so the run is not made again under its id, no retry on status 503 matches it, and a person or a workflow rule that names the kind decides                                                     |
| `unavailable`, kind `requests_full`            | The brain already has as many open requests as the runtime allows, 10,000 unless its operator sets another number                                                                                                                                                                         |
| `rejected` as `unanswered`, kind `expired`     | Nobody answered the request before it expired                                                                                                                                                                                                                                             |
| `rejected` as `unanswered`, kind `undelivered` | Every attempt to deliver a notification failed                                                                                                                                                                                                                                            |
| `rejected` as `cancelled`                      | `cancel_run` cancelled the run, or the workflow that waited for it ran out of time or ended first                                                                                                                                                                                         |
| `failed`                                       | The runtime itself broke down                                                                                                                                                                                                                                                             |

After a call of a tool that may change something, an answer the run cannot use still ends `unworkable`, and its detail says that a run again calls the tool again. A request that has ended is final for its run id: answering it is `conflict`, and running the function again starts a new request under a new id.

The run's history shows the request as `interaction_requested`, with the delivery, the party, the size of the message, whether it takes an answer and the expiry; then each delivery attempt as `delivery_started`, with the tool and the size and digest of its arguments, and how it ended: `delivery_succeeded`, with the size and digest of what the tool answered and, where the delivery writes `sent`, what the message was delivered as and where its replies are read; `delivery_failed`, with `because`, `tool_error`, `arguments_refused`, `server_failure`, `timed_out`, `tool_not_offered` or `lost`, its words, and the wait a server asked for as `retry_after_ms`; or `delivery_refused`, with `because` `too_large` or `unworkable`; each reply taken or refused as `reply_taken` or `reply_refused`, with the reply's identity and never its words; and the run's end. A function with `call` shows its call as `tool_call_started` and `tool_call_answered`, or `tool_call_failed` when the tool never answered. The brain keeps the arguments, the message among them, and what the tool answered whole, scrubbed of secrets, unless the operator turns `record_content` off for the server; the history shows each where it takes at most 2 KiB, and its size beyond, and `get_event` reads one event with both whole. An answer is the run's output, which its `run_succeeded` shows where it takes at most 2 KiB and `get_run` returns whole. `list_brain_events` shows the brain's reads of a conversation, `replies_read` or `reading_failed`, and its tellings, `telling_started` and then `telling_succeeded` or `telling_failed`.

## Bounds

| Bound                                         | Value                                                                                                            | When it is reached                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The rendered party, and the answerer          | 256 bytes, no control character                                                                                  | `conflict`, `unworkable`                                                        |
| The rendered message                          | 8 KiB                                                                                                            | `conflict`, `unworkable`                                                        |
| The arguments of a call                       | 16 KiB as JSON                                                                                                   | `conflict`, `unworkable` at the start; a read or telling not sent               |
| The arguments of a call that reads no `input` | 16 KiB as JSON                                                                                                   | Refused when saved                                                              |
| A call of the tool                            | 10 seconds to open, 30 seconds to answer                                                                         | A failed attempt or read                                                        |
| A function's call of its tool                 | 10 seconds to open, 10 to list the tools, 30 to answer                                                           | `mcp_server_failed` before sending; then `tools_unfinished` or `effect_unknown` |
| What a function's `read` takes                | 1 MiB as JSON with the run's record, 512 levels                                                                  | `conflict`, `unworkable`                                                        |
| Calls in one run of a function with `call`    | 1, within 70 seconds                                                                                             | —                                                                               |
| What `sent` reads, and the conversation key   | 256 bytes of text each, no control character                                                                     | Delivered without what it was delivered as; the request takes no reply          |
| A read's answer                               | 64 KiB                                                                                                           | A failed read; the reading goes on                                              |
| A reply's words                               | 8 KiB                                                                                                            | The reply is refused                                                            |
| A reply rule                                  | 16 values, 16 words a value, 64 bytes a word                                                                     | Refused when saved                                                              |
| Refused replies of a request                  | 10 recorded, 3 told                                                                                              | Further ones leave no trace, or are recorded and nobody told                    |
| Reads of a conversation                       | 5 seconds after a request joins, then 10, 20 and 40, every minute, and every 5 minutes, never sooner than `wait` | —                                                                               |
| `expires`                                     | 1 minute to 30 days                                                                                              | Refused when saved                                                              |
| An answer                                     | 64 KiB as JSON, 512 levels                                                                                       | `invalid_input`                                                                 |
| `claimed_for`                                 | 256 bytes                                                                                                        | `invalid_input`                                                                 |
| Attempts                                      | 5: at once, then after 1, 2, 4 and 8 minutes                                                                     | A question stays open; a notification ends `unanswered` as `undelivered`        |
| Open requests of a brain                      | 10,000 unless the operator sets another number                                                                   | `unavailable`, `requests_full`                                                  |

## In a workflow

A workflow calls an interaction function as it calls any function, with `call: run_definition` and `type: interaction`. A function with `call` answers within the call: the step's output is what the tool answered at `read`, and the step waits at most 70 seconds and a minute for it. A 503 it raises, `mcp_server_failed`, `tool_not_offered` or `tools_unfinished`, is safe to try again, and so is matched by a retry on that status; `effect_unknown` raises 409 under the [problem type](http.md#responses-and-errors) `https://on.auto/problems/effect_unknown`, which a `catch` retries only where it names that type or kind. For a function that asks a person, the step waits for the request, as long as the function's `expires` and a minute more, holding nothing of the server, across a restart, and its output is the answer. A request nobody answers raises an error of the [problem type](http.md#responses-and-errors) `https://on.auto/problems/unanswered`, status 410, with the kind `expired` or, for a notification, `undelivered`. No retry policy matches it unless it names that type, so a workflow handles an unanswered request only on purpose, and a workflow that does not catch it ends `rejected` as `unanswered` with the same kind. When the step runs out of time, or the workflow ends first, the request is cancelled.

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
            call: run_definition
            with:
              type: interaction
              name: approve-brief
              input: '${ $data }'
      catch:
        errors:
          with: { type: https://on.auto/problems/unanswered, kind: expired }
        do:
          - unapproved: { set: { choice: unanswered } }
```

The run ends `succeeded` with the answer, such as `{"choice": "approve"}`, as its output, or with `{"choice": "unanswered"}` when the request expired. `list_interactions` shows the request while it waits, under the `run_id` of the interaction function's run.

`send_run_event` remains for events a waiting workflow listens for that are not the answer to a question.

## Availability

Interaction functions are available in a self-hosted runtime, through the inbox and the tools of the tool servers its operator configures. See [Functions and availability](../concepts/functions.md#availability).

</div>
