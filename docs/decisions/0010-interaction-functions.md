# 0010 — Interaction functions: a brain asks a person or a system and waits for the answer

**Status:** accepted (2026-10-07), with the amendments from the build at the end

## Context

A brain reasons, interacts, predicts, recalls and computes, and coordinates those functions through workflows. Reasoning and workflows run today, computation and recall are built or building, reacting lands with the matcher and its follower (0004), and waiting calls (0011) let a workflow wait for a run that finishes later and cancel a run from outside. The interaction capability is a README that says an interaction function "exchanges input or output with people or systems", such as requesting an approval, sending a notification or receiving structured input, and the terminology page says the same, with "Request budget approval" as the example of its name.

What exists for the simplest case. A workflow step waits with `listen`, and a person or a system answers by sending an event to the run by id; the public workflows page calls this an approval. That idiom leaves everything to the author and the caller: the workflow carries no definition of what was asked, nothing is delivered anywhere, nobody knows what is waiting for whom, the answer's shape is checked by nobody, and a question nobody answers waits until the step's `timeout`.

The model the simplest case lacks is known. The question is a fact on the run's own stream, with whom to ask, the question, options, data, a reason, an expiry and a channel; the run reads as waiting; a person's answer or an expiry is a fact that completes the asking step with the answer as its output; and nothing waits in memory. What such a model needs beyond that: a channel that a delivery actually uses, a timer of its own so that an expiry needs no outside caller, an answerer the runtime records rather than one claimed, and a definition rather than a kind of step, so the same question can be saved, versioned and reused.

What exists to build on, verified against the code at adf527b, and what does not:

- A capability may answer `finishesLater` with a record, recorded as `execution_deferred`; the settlement is a command on the run's stream, refused once one has landed and retried on version conflicts, so an answer racing an expiry is decided by the stream; a run list omits the deferral's record by design, and the latest message moves on at the first fact of the run's work. Waiting calls (0011) carry a settlement's actor and whole result under a key, give the deferred decider two counts, the number of the last call and whether anything may have changed outside, cancel a run from outside with the reason `cancelled`, and deliver a child's ending to its parent through the host's follower.
- The tool-call journal exists only inside an HTTP or MCP request, with its causes in a memory cell and its numbers in a per-run counter; the tool-call facts are MCP-shaped; MCP refuses arguments over 16 KiB measured as the UTF-8 bytes of the JSON and ends a run after five failures, bounds made for the reasoning loop; the MCP tool access is created inside reasoning's setup; the untrusted-certificate code list is duplicated in the reasoning adapter and the MCP package, while proxies come from Node's environment for both.
- The workflow host's loop fires at most 256 timers per tick, 16 at once, under its lease; a timer that fails to fire is postponed every sweep.
- Settings: the JSON-setting reader exists in three copies, the org-and-brain binding and the reference-placement rules live only in the MCP package, substitution resolves `${…}` in every string of a setting; a reasoning function's model is not checked at save, an unoffered model is `unavailable` `model_not_offered` at run time.
- The shared document reader is on the computation branch (0005); the Liquid engine is one shared instance in the reasoning capability carrying its system block and prompt filters, a template reads only `input`, `today` and `now`, and a value that is not a string renders as `[object Object]`; no reasoning template corpus exists beyond the rendering tests.
- The API sends `Retry-After` for every `unavailable` but a short list of kinds; a workflow maps an `unavailable` without a type of its own to a `communication` error, which the format's retry example matches; problem and error types are keyed by kind, and the settler, the replay, the presenter and the workflow mapping each know the three reasons by name.
- The ledger's inline projections are hard-wired to run outcomes at every layer (0008); every message carries its cause and correlation; `publish_event` accepts any extension attribute, so `causationid` and `correlationid` can be forged; `brainFactOf` publishes a run's start and endings with the subject `<primitive>/<name>`; a rejection keeps an optional record on main, which analytics reads.
- A caller is an API key id, or `local`; `brain:write` is the only scope a command can require; the brains page says an approval step cannot protect an action someone else may call.

## Decision

### 1. An interaction function is a definition in a document of the same shape as a reasoning function

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
      note: { type: string, maxLength: 2000 }
---

Please review the brief for {{ input.campaign }}.

{{ input.summary }}

Reply **approve** or **reject**, with a note if you reject.
```

The front matter uses Dotprompt's keys where they apply, `description`, `input` and `output`, and three keys of its own: `channel`, the name of a channel the operator configured, or `inbox`; `to`, a template over the input naming the party, an address the channel understands or, for the inbox, a name the brain's readers filter by; and `expires`, required, an ISO 8601 duration from one minute to thirty days parsed by the format's duration reader, after which an unanswered request ends. `output.schema` is the shape an answer must have, and **the run's output is the answer itself**, so a run's output matches its declared schema like every other function's; a function without `output.schema` is a **notification**, which needs no answer and whose run succeeds, with an empty output, when its delivery lands. The body is the message, a Liquid template over `input`, `today` and `now`, rendered with the same rules as a prompt: the template engine moves out of the reasoning capability into a folder of its own in the specs package beside the document reader of 0005, as a factory that gives each capability an instance of its own, so the system block and the prompt filters stay the reasoning capability's registrations; the build captures the rendering of every reasoning template in the rendering tests before the move and asserts it after. A rendered value is text and is never parsed again as a template. `model`, `config`, `tools` and `language` are refused as unknown. The document's media type is `text/markdown`.

Parsing is validation and pure, as for every definition: a `to` or a body that does not compile or reads anything but `input`, `today` and `now`, an `expires` outside its bounds, a schema that is not a JSON Schema, an unknown key, each rejected with its line. The channel is not checked at save, as a model is not: a run whose channel this server does not have ends `unavailable` with the kind `channel_not_offered`.

### 2. A run asks, waits as a deferred run, and is settled once

The capability declares on its prepared definition that its runs finish later, so a start records `finishes_later` as 0011 says. `execute_spec` of an interaction function records the start, validates the input and renders `to` and the message; a `to` or a message that renders to something that is not text, a `to` that is empty, holds a control character, exceeds its bound or does not match the channel's allowed pattern, and a message over its bound, end the run `conflict` `unworkable` with a pointer, a recorded run as every capability's refusal is; for an MCP channel the tool's arguments are rendered and measured as the bytes MCP measures, and arguments over the bound end the run the same way. The run then defers: **the deferral's record is the request**, the channel, the party, the rendered message, the answer schema as recorded and `expires_at`, and no later fact repeats it. The inbox reads the request from the read model of section 4, never from the run list.

The run waits as a deferred run, with nothing in memory. **The read model is the schedule**: the open-requests projection of section 4, written in the same transaction as every fact of the run, holds the request's `expires_at`, its next delivery attempt and its time, and one `due_at`, the earlier of the two, which one partial index across brains serves; the host reads due rows through a port the projection registers with it, never a table by name; the loop, under the lease, performs due rows as it performs timers, at most 256 per tick, 16 at once, before the workflow timers of the same tick, so a request that expired during downtime ends as expired and not at its caller's deadline; a `delivery_started` moves the row's `due_at` past the call's bound while the attempt is in flight; a settlement refused because the run has just ended, an answer that won the race, is a no-op for the loop; a perform that fails for a transient reason is retried by the loop with a doubling wait kept in memory per row, so a few bad rows never hold the tick; a due row of a run that has ended is closed by the fact that ended it and is never performed; there are no timer rows for a request, nothing to re-arm, and no crash window between a fact and its schedule. The first attempt is due at the deferral.

The run is settled by exactly one settlement, the command of 0011 with its key, which refuses a second with a different key and answers the one that landed for the same:

- `answer_interaction`, `POST /executions/{execution_id}/answer`, under `brain:write`, also an MCP tool, or over HTTP alone with the request's **answer token** of section 3 as a second credential scheme, `Authorization: Request <token>`, which the API's authentication hands on unverified as a principal with no permission, and which this one operation, flagged as authorizing itself by token at its registration, verifies against the run's deferral and its channel's secret before anything else: the answer is validated against the schema recorded in the request, with pointers, and the settlement is `succeeded` with the answer as the output and a record holding `answered_by`, the authenticated caller or the channel that carried the token, `claimed_for`, what the caller says it answered for, bounded like event text, never used in authorization or a filter and worded as a claim wherever it is shown, and `answered_at`; the settlement's key includes the answer's digest, so the same answer again answers what landed and a different one is `conflict`; an answer to a request that has ended is `conflict`; an answer that fails the schema is `invalid_input` and leaves the request open;
- the expiry, performed by the loop as a settlement `rejected` with the new reason **`unanswered`** and the kind `expired`, the host as actor;
- a notification whose attempts are spent, `rejected` `unanswered` with the kind `undelivered`;
- a cancellation, through `cancel_execution` of 0011, whose `cancel` hook for this capability answers `rejected` `cancelled` with the caller's kind; a calling step's deadline and the end of the calling run reach the request the same way, by the derived id. There is no separate withdrawal.

`unanswered` is a rejection reason of its own beside `invalid_input`, `unavailable`, `conflict` and `cancelled`, carried through the settlement schema, the listed rejection, the explanation table, the settler, the replay, the presenter and the workflow mapping, with its problem type, status 410, which sends no `Retry-After`, and its workflow error type, which no retry policy matches by accident; a workflow that does not catch it ends `rejected` `unanswered` with the kind, as a workflow ends with a tool error it does not catch. A lapsed or cancelled request is a **final result for its id**, as a success and an `invalid_input` are: a call with the id answers it and runs nothing, so asking again is a new run under a new id, knowingly. The request stays readable after the ending in the deferral fact and the history, although the run's record is then the ending's.

### 3. Delivery is a recorded outbound call, scheduled by the read model

The tool-call journal of 0003 becomes the **outbound call journal** of any run: a fact recorded on the run's stream before the call is sent, numbered by the decider's count of 0011 so a fire repeated by two hosts is refused by number, with its cause the request's message id, which the read model's row holds, and its actor the host; the facts are `delivery_started` and `delivery_ended`, with the attempt, the channel, the target and the outcome, scrubbed and cut as tool-call facts are, beside the tool-call facts, which keep their shape, the attempt's number the one the read model's row expects; the journal is opened by the loop from a stream writer and the run's lineage, with no request behind it. The MCP package gains a single-call entry point with delivery bounds of its own, a connection bound of 10 s, a call bound of 30 s, a 429 honoured within the schedule, the result cut at 4 KiB, no tool listing per delivery, a delivery id in `_meta` so a receiver can deduplicate; the composition root owns the MCP tool access and gives it to both capabilities. The reasoning adapter's untrusted-certificate classification and the MCP package's move to one place, a new package `@beonauto/outbound` that holds the outbound HTTP client, the certificate classification and the Standard Webhooks signing, every caller keeping its own bounds, so streaming MCP and model responses are untouched.

- **`mcp` channels**: one tool call on a configured MCP server, its arguments rendered from the request's fields, `to`, `message`, `run_id`, `function`, `expires_at`, `answer_schema`, by the channel's `with` templates, each a string, `| json` for a structured value, a value that renders to something other than text refused when settings are read; the channel must lie within its server's org and brains and its tool within `allowed_tools`; a tool error, including a gateway's refusal, a server failure, a timeout and a tool no longer offered, is a failed attempt.
- **`webhook` channels**: an HTTP POST of the request as the CloudEvent `interaction_requested`, a reserved type that presents the deferral's record, in CloudEvents structured mode, carrying the server's origin, the org, the brain, the run id, the message, the party, `expires_at`, the answer schema and, in the signed body and never in a URL, an **answer token**, an HMAC-SHA256 with a key derived from the channel's secret for this purpose alone, over the request's message id, valid for that request and accepted by `answer_interaction` as the credential of section 2, so a system party answers later without holding a brain key and the answer is recorded as the channel's; signed on every attempt with the Standard Webhooks headers, `webhook-id` the request's message id, `webhook-timestamp`, `webhook-signature` with the secret in the `whsec_` form; HTTPS only, except loopback; redirects refused as a failed delivery; the body bounded; the response read to at most 64 KiB and cut; 10 s. A 2xx is a delivery; 408, 429 and 5xx and connection errors are failed attempts tried again, 429 honouring `Retry-After` within the schedule; any other 4xx is a failed delivery not tried again. A channel with `answers: true` may answer within the delivery: a 200 whose body is JSON within 64 KiB and valid against the recorded schema settles the run as answered by the channel, after the attempt's fact; a body that is not JSON, exceeds the bound or fails the schema is a failed attempt with the reason recorded, so no receiver answers by accident; a channel without `answers` ignores the body.
- **`inbox`**: no delivery; a notification to the inbox succeeds at once, since nothing is to be delivered.

Attempts follow a schedule of five: the first at the deferral and the others 1, 2, 4 and 8 minutes after the one before, so the last lands a quarter of an hour in; the row's next attempt closes with the run, so no attempt is made after a settlement, and an attempt that lands after the run ended is recorded and changes nothing. A request whose attempts are spent stays open with its standing in the read model and the history, since the party may still find it; a notification's run ends `unanswered` `undelivered`. A channel removed from settings while requests are open ends each remaining attempt as failed with `channel_not_offered`, and the requests stay open.

### 4. Channels, and what is waiting

`channels` in the configuration file, or `CHANNELS` as JSON in the environment, read by the settings machinery that `mcp_servers` uses, which moves from the MCP package into the config package so both share it: the JSON-setting reading, the org-and-brain binding, the reference-placement rules and the credential checks on URLs. `${…}` references are allowed in `headers` and `secret` and refused everywhere else, so a secret can never reach a template, and a `with` template may not contain `${`. Each channel declares `to` as an allowed pattern, a regular expression the rendered party must match, so a brain cannot address anything the operator did not allow; `inbox` is a reserved name. Templates are compiled when settings are read, with the setting's location in a refusal.

```yaml
channels:
  approvals:
    type: mcp
    server: slack
    tool: post_message
    to: '^#approvals-[a-z-]+$'
    with:
      channel: '{{ to }}'
      text: '{{ message }}'
    org: acme
  partner:
    type: webhook
    url: https://partner.example.com/brain/requests
    headers:
      Authorization: Bearer ${PARTNER_API_KEY}
    secret: ${PARTNER_WEBHOOK_SECRET}
    to: '^[a-z]+@partner\.example\.com$'
    answers: true
    org: acme
    brains: [sales]
```

What is waiting is the **open-requests read model**: an inline projection kept inside the append's transaction as run outcomes are, through the ledger's projection facility made generic for this, registered at composition with its versioned table, its fill and its read, which the ledger needs to serve any projection and not one; its mapping lives in the interaction package, since specs must not know the request's shape. One row per request: the brain, the run, the request's message id, the function and its version, `to`, the channel, `expires_at`, the next attempt's number and time, the delivery's standing, and whether the request is open; written on the deferral, each attempt and the settlement; indexed by brain and `to`, by brain and function, by due time across brains for the loop, and by brain and open for the count. `list_interactions`, `GET /interactions`, under `brain:read`, also an MCP tool, in the interaction package beside `answer_interaction`, lists a brain's open requests newest first with the request's fields and the `execution_id` to answer, filtered by `to` and by `function`, paged; the same rows give the count that bounds open requests. `get_execution` shows a request's run in full, and the history shows the request, each attempt and the ending in plain words, the answer's values withheld as outputs are, within 4 KiB, status codes written as words; the deferral's words are the capability's, "waiting for an answer", because the execution presenter asks the run's capability, by primitive, for the words of its deferral and its work.

### 5. Facts and events

No fact repeats another: the deferral is the request, the delivery facts are the attempts, the settlement is the answer, the expiry or the cancellation, with its actor and kind, each carrying the capability, the name and the version as finish events do. `brainFactOf` publishes an interaction run's start and endings as it publishes every run's, with the subject `interaction/<name>`, the ending's data holding the answer or the kind and the actor, and every event's cause and correlation as the extension attributes `causationid` and `correlationid`, which `publish_event` reserves so they cannot be forged, so another workflow can react to an answer with the matcher of 0004 and a recall function can fold what was asked and answered. The run graph shows the request as the deferral under the calling step's wait, each attempt caused by the request, and the ending caused by what settled it. Analytics counts the run with its duration, which for an answered request is the time to the answer.

### 6. Bounds and guards

| Bound                         | Value                                                                                                                                     | When reached                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Rendered message              | 8 KiB in UTF-8                                                                                                                            | `conflict`, `unworkable`, before anything is appended                  |
| Rendered `to`                 | 256 bytes, no control characters, matching the channel's pattern                                                                          | `conflict`, `unworkable`                                               |
| MCP delivery arguments        | 16 KiB in UTF-8 as MCP measures them, checked at the run's start                                                                          | `conflict`, `unworkable`                                               |
| `expires`                     | 1 minute to 30 days; the calling step's own deadline caps the wait (0011)                                                                 | refused at save; `timeout` on the step                                 |
| An answer                     | 64 KiB as JSON, 512 levels, within the run's 1 MiB record                                                                                 | `invalid_input`                                                        |
| `claimed_for`                 | 256 bytes, event-text rules                                                                                                               | `invalid_input`                                                        |
| Delivery attempts             | 5, the first at once and then after 1, 2, 4 and 8 minutes, 16 at once per host                                                            | the request stays open; a notification ends `unanswered` `undelivered` |
| A webhook's body and response | 240 KiB out, 64 KiB in, 10 s                                                                                                              | a failed attempt                                                       |
| Channels                      | 32 per server, each one org                                                                                                               | refused at start                                                       |
| Open requests per brain       | 10,000, the setting `INTERACTION_OPEN_REQUESTS`, counted in the read model; a race may overshoot by the requests in flight                | a new run `unavailable` `requests_full`                                |
| Due rows performed            | 256 per tick, before the tick's workflow timers; the build measures 10,000 expiries in one minute and states how late workflow timers get | —                                                                      |

Who may answer is `brain:write` on the brain, or the request's answer token; a key may answer a request its own workflow asked, which the brains page says in the words it has for approval steps, and the enforcement that the answering identity is the party, or one allowed for it, goes into `answer_interaction` when identities exist. `list_interactions` shows a request's party to every reader of the brain, as the run's input is shown. The hosted runtime does not offer interaction functions until it offers channels, as it does not offer tools.

### 7. In a workflow

A workflow calls an interaction function through `execute_spec` as it calls any function; the step waits for the run as a waiting call (0011), up to `expires` plus the grace, and receives the answer as its output or an `unanswered` error with the kind `expired` or `undelivered`, or a `cancelled` error, which a `catch` names and no retry policy matches by accident. A step cancelled by its deadline or by its run's end cancels the request. The format's `listen` and `send_execution_event` remain for events that are not answers to a question. The workflows page's approval example becomes an interaction function, and the tutorial's first workflow asks for an approval through the inbox.

### 8. What this record does not decide

Identities and roles, so who may answer is still the brain's writers and the request's token; reminders before the expiry, which the same schedule would carry; questions to several parties and quorums; a conversation of several turns; interaction functions started by a trigger rather than by a workflow; channels Auto Cloud provides; the studio's inbox screen; an inbound request from a party, which is a published event; secret rotation for webhooks.

## Consequences

- The brain gets a way to ask and wait that is a definition: saved, versioned, reused by every workflow, delivered somewhere by an allowed address, with a checked answer that is the run's output, an expiry that fires by itself, a record of who answered, and an ending no one re-asks by accident.
- Nothing new waits in memory and no second schedule exists: a request is a deferred run, its facts are the run's own, the schedule is the read model kept in the same transaction, the delivery is a recorded outbound call, and a system party answers with a token bound to its request.
- Debts paid on the way: the outbound call journal serves any run from any trigger with numbers and causes from the ledger; the MCP tool access is the composition root's; the outbound HTTP client and the certificate classification live once; the settings machinery for operator-configured endpoints is the config package's; the template engine is a shared factory; a capability gives the words for its own runs; the ledger's projections are generic; `publish_event` cannot forge lineage.
- Debts named for a change of their own: the hand-kept status map, reserved types and internal-terms list derived from the schemas and presenters; `isFunctionRun` and the labels derived from the capabilities; the `ALTER TABLE` migrations on the host's tables removed since nothing is live.

## Verification the build must include

- Parsing: every refusal of section 1 with its line; a notification without `output.schema`; reasoning's rendering captured before the move and asserted after; a rendered value never parsed again.
- Runs through the real server over HTTP and MCP against a fake MCP server and a fake webhook receiver: a request on each channel kind and the inbox, the deferral holding the request and the inbox showing it; a delivery recorded before it is sent with the decider's number and the request's id as its cause, an attempt repeated by two hosts refused by number, an attempt fired after a restart from the read model; a webhook signed and verified with an independent Standard Webhooks check, the same `webhook-id` on retries, a redirect and plain HTTP refused, a 4xx not retried, a 5xx and a 429 retried on the schedule, the attempts spent leaving the request open, a huge response cut, an answer within the delivery on a channel with `answers: true` and ignored without it, invalid JSON and a schema failure on such a channel failed attempts, an answer through the token and a token of another request refused; an answer validated against the recorded schema with pointers, recorded with the caller and the claim, the output the answer itself, reaching the calling step as its output; the same answer again answering what landed and a different one `conflict`; the expiry performed after a host restart from the read model and settling `unanswered` `expired`, which a workflow `catch` names, no retry matches, and an uncaught one ends the workflow `unanswered`; a cancellation through `cancel_execution` and through a calling step's deadline; a second answer and a late answer `conflict`; a lapsed request final for its id; a notification succeeding on delivery and ending `undelivered`; a `to` outside the channel's pattern, empty, or not text refused; a channel removed from settings ending attempts `channel_not_offered` with the request open; a message, `to`, arguments and answer at each bound.
- The schedule: expiries and attempts performed on the lease holder only, after workflow timers, with 10,000 expiries in one minute measured and the lateness of workflow timers stated; a due row of an ended run never performed.
- Reads: `list_interactions` by `to` and `function` on both stores, the count, the standing; the history's words within 4 KiB with the answer withheld and status codes in words; the facts as CloudEvents with cause and correlation, `publish_event` refusing the two names, and another workflow reacting to an answer; the run graph's causes for the exchange; analytics counting the run with its time to answer.
- Secrets never in a template, a log or a record; the internal-terms check; the references, the configuration page, the terminology page's new words, the workflows page's approval example, the tutorial, the availability row, the tool count; the CI smoke step: an interaction function through the inbox, answered over HTTP, in the image.

## Build

After waiting calls (0011), which build after the reactions matcher (0004) and computation (0005).

1. `@beonauto/config`: the shared settings machinery and `channels`. `@beonauto/outbound`, new: the HTTP client, the certificate classification, Standard Webhooks signing and the answer token. `@beonauto/operations`: the `unanswered` reason with its kinds, `channel_not_offered` and `requests_full`, the problem types, the reserved extension names. `@beonauto/ledger`: projections registered generically with versioned tables, fills and reads. `@beonauto/specs`: the template engine factory in its own folder, the outbound call journal for any run with the delivery facts, the presenter asking the capability for its words, the facts' cause and correlation, `unanswered` through the settler, the replay, the presenter and the workflow mapping. `@beonauto/mcp`: the single-call entry point with delivery bounds, the settings machinery moved out, the certificate classification moved out. `@beonauto/workflow-host`: the loop performing due rows of a projection after its timers. `primitives/interaction` as `@beonauto/interaction`: the document, the run, the channels, the open-requests projection and its read, `answer_interaction` and `list_interactions`, the `cancel` hook, the words; wired into the server's composition with the tool access from the root, and the CI smoke step.
2. The documentation: the reference page for interaction functions, the configuration page's channels, the workflows page, the tutorial, the terminology page, the availability row, the HTTP and MCP references.

## Amendments from the build

What building it showed, and what it changed in the decision above:

- **Due rows handed out before the timers.** The loop hands out the due rows of a tick before its workflow timers, as section 2 and the bounds table say, and the verification and build lists, which say "after", are read as that; it performs them in the background, 16 at once, and waits for them a second at most before it fires the timers, so a delivery that hangs holds no timer longer.
- **An attempt that ends after its run is not recorded.** The run's decider refuses every fact after the run's ending (0011), so an attempt that ends after an answer, an expiry or a cancellation records no `delivery_ended` and changes nothing, where section 3 says it is recorded.
- **The pattern of a channel matches the whole party.** A channel's `to` is matched against the whole rendered party, as if written between `^` and `$`, so a pattern that leaves them out admits no longer address.
- **A channel names its type.** Every entry of `channels` names its `type`, `webhook` or `mcp`, which the settings read rather than infer from the entry's fields.
- **The origin is a setting.** The server's origin, which a delivered request names in its `source` and `answer_url`, is the new setting `PUBLIC_ORIGIN`, and `http://localhost` with the port the server listens on when it is unset.
- **`answers` belongs to webhooks.** `answers: true` is a field of a webhook channel alone, since the result of an MCP channel's tool is a delivery and never an answer.
- **A 429 met while an MCP connection opens keeps no `Retry-After`.** The MCP client reports a 429 met while it opens a connection without the header, so that attempt waits as the schedule says rather than as the server asked.
- **What causes the ending.** The history's graph shows each attempt caused by the request and its end by its start, an ending that follows a delivery, an answer within it or a notification delivered or spent, caused by the end of that delivery, and one answered through `answer_interaction` or expired caused by the request, since nothing the brain records stands for an answer given through the API or for a moment that passed.
- **The schedule, measured.** 10,000 requests made due at one moment after a restart were all settled `unanswered` as `expired` within 7.8 seconds on SQLite and 8.8 seconds on PostgreSQL, and the workflow timers due in those seconds fired at most 0.55 s late against at most 82 ms with no request due, at one-minute load averages of 1.6 to 8.2 on 16 cores, as the workflow host's README sets out.
