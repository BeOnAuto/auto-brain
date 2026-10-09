<div v-pre>

# Build your first workflow

Turn the campaign review from [Build your first brain](first-brain.md) into a workflow. It reviews a brief, then asks the campaign's owner to approve it, and waits for the answer. You will save an interaction function that asks for the approval, save the workflow, start a run, find its request in the brain's inbox, answer it, and read the finished run.

The campaign and figures below are sample data. This exercise makes no changes to advertising accounts or campaign budgets.

## Before you start

Complete [Build your first brain](first-brain.md) first. This exercise uses its practice brain, `campaign-review-tutorial`, and its reasoning function, `review-campaign-brief`, which takes one required input, `brief`.

Your agent needs a connection with permission to create and run definitions in that brain. Every runtime offers workflows. The approval is an interaction function, which a self-hosted runtime offers, such as the one [Connect your agent](../get-started/local.md) starts; the first check below shows whether your connection offers it.

## 1. Check the tools

Ask your connected agent:

> List the Auto tools you can call. Tell me whether `list_interactions` and `answer_interaction` are among them, and which values the `type` field of `create_definition` accepts.

The agent should report `list_interactions` and `answer_interaction` among the tools, and `reasoning`, `interaction` and `workflow` among the accepted values of `type`, the types of reasoning functions, interaction functions and workflows. The tools also include `send_run_event`, which sends a waiting run an event that is not the answer to a question.

If neither `create_definition` nor `list_interactions` is listed, the connection uses an organization endpoint, which offers brain management and model discovery only. Connect your agent to the runtime's `/mcp` endpoint or to the brain's own endpoint before continuing; [MCP endpoint scope](../reference/mcp.md#endpoint-scope) lists them.

## 2. Confirm the reasoning function

Ask:

> In `campaign-review-tutorial`, read back the reasoning function `review-campaign-brief`. Show its version and the inputs it requires. Do not change it.

You should see `review-campaign-brief`, its version, and `brief` as its required input. If the function is missing, complete Build your first brain before continuing.

## 3. Save the interaction function

The interaction function asks one person for a decision. Its run renders the message from its input, leaves the request in the brain's inbox for the party named in `to`, and waits until someone answers, the request expires after two days, or the run is cancelled. The answer must match `output.schema`, and the answer is the run's output.

> In `campaign-review-tutorial`, create an interaction function named `approve-campaign-brief` from the document below. Use the document unchanged as the source, with the type `interaction`. If a function with that name already exists, show it to me instead of changing it. Then show me the saved function's version and description.

<!-- prettier-ignore -->
```markdown
---
description: Asks the campaign owner to approve a reviewed brief
to: '{{ input.owner }}'
expires: P2D
input:
  schema:
    type: object
    required: [owner, review]
    properties:
      owner: { type: string }
      review: { type: string }
output:
  schema:
    type: object
    required: [verdict]
    properties:
      verdict: { type: string, enum: [approve, revise] }
      note: { type: string, maxLength: 2000 }
---
The review of your campaign brief is ready:

{{ input.review }}

Approve the brief as it stands, or ask for a revision.
```

The agent should confirm the interaction function `approve-campaign-brief` at version 1. The tool's summary reads: Created the interaction function “approve-campaign-brief”. What it does: Asks the campaign owner to approve a reviewed brief. It has been saved but has not been run yet.

## 4. Save the workflow

The workflow has two steps. `review-brief` runs the reasoning function on the brief the run starts with and keeps the owner beside the review. `ask-for-approval` runs the interaction function with the owner and the review, and waits for its answer. The run's output keeps the review and the approval.

> In `campaign-review-tutorial`, create a workflow named `review-and-approve` from the document below. Use the document unchanged as the source, with the type `workflow`. If a workflow with that name already exists, show it to me instead of changing it. Then show me the saved workflow's version, description and required input.

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-review-tutorial
  name: review-and-approve
  version: '1.0.0'
  summary: Reviews a campaign brief, then asks its owner to approve it.
input:
  schema:
    document:
      type: object
      properties:
        brief: { type: string }
        owner: { type: string }
      required: [brief, owner]
do:
  - review-brief:
      call: run_definition
      with:
        type: reasoning
        name: review-campaign-brief
        input:
          brief: ${ .brief }
      output:
        as: '${ { owner: $input.owner, review: . } }'
  - ask-for-approval:
      call: run_definition
      with:
        type: interaction
        name: approve-campaign-brief
        input:
          owner: ${ .owner }
          review: ${ .review }
      output:
        as: '${ { review: $input.review, approval: . } }'
```

The agent should confirm the workflow `review-and-approve` at version 1, with the description from the document's `summary` and with `brief` and `owner` as its required input. The tool's summary reads: Created the workflow “review-and-approve”. What it does: Reviews a campaign brief, then asks its owner to approve it. It has been saved but has not been run yet.

If the agent reports issues under `/source`, each gives a line and a column. Compare that line with the document above; [Workflow format](../reference/workflow-format.md) describes every field.

## 5. Start a run

Ask the agent to run the workflow with this text as the `brief` input and `ada@example.com` as the `owner`:

```text
Campaign: Autumn reporting trial
Audience: Businesses that need better reporting
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: Generate interest in the product
```

> Run the workflow `review-and-approve` in `campaign-review-tutorial` with the brief above as its `brief` input and `ada@example.com` as its `owner`. Show me the run's id and status, and keep the id for later.

The run should answer with a `run_id` and `status: started`. The tool's summary reads: The workflow “review-and-approve” has started and is still running. It carries on by itself, and how it ends can be looked up later.

The run reviews the brief, then asks for the approval and waits. Check it:

> Read the Auto run with that run id and show its status.

It should still show `status: started`, and the tool's summary reads: The workflow “review-and-approve” is still running; how it ends can be looked up again later. A run that waits for an answer stays started until the answer arrives.

## 6. Read the inbox

> List the open requests of `campaign-review-tutorial`. Show the run id, the party, the message, the expiry and the standing of each.

The agent should show one request, to `ada@example.com`, waiting in the inbox with no `delivery`, with the standing `in_inbox`, an `expires_at` two days ahead, and the message rendered from the review. The tool's summary reads: Found 1 request waiting on this page.

The request has a `run_id` of its own: it is the run of the interaction function that the workflow started, and it is the id to answer.

## 7. Answer the request

> Answer that request with the verdict `approve` and the note `Approved for the autumn launch.` Show me what the answer settled.

The agent should report the run of `approve-campaign-brief` `succeeded`, with the answer as its output. The tool's summary reads: The request is answered: the run that asked it succeeded, with the answer as its output.

An answer that does not match the function's `output.schema`, such as the verdict `maybe`, is refused with `invalid_input` and a pointer under `/answer`, and the request stays open.

## 8. Read the finished run

> Read the workflow run again until its status is no longer `started`. Show its status, definition version, finish time and output.

The run should show `status: succeeded`, `definition_version: 1`, a `finished_at` time and an output with two fields: `review`, the reasoning function's review, and `approval`, the answer you gave, `{ "verdict": "approve", "note": "Approved for the autumn launch." }`.

The review comes from your model, so its wording can vary. For this brief it should recommend Revise: the audience lacks a job role and type of company, and the success measure lacks a numeric target. The approval is the decision of whoever answered; the workflow records both.

Then read how the run got there:

> Read the history of that run. Show each event's type and summary and, for each `workflow_input_applied` event, the steps that moved and how each ended.

The tool's summary reads: Found 9 events in the history of the run, oldest first.

| Type                     | Summary                                                                        | Steps that moved                                                 |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `run_started`            | A run of the workflow “review-and-approve” started.                            |                                                                  |
| `workflow_input_applied` | The workflow started, and 1 step moved.                                        | `/do/0/review-brief` waiting                                     |
| `step_waiting`           | The step “review brief” waits for a function it called.                        |                                                                  |
| `workflow_input_applied` | A function the workflow called answered, and 2 steps moved.                    | `/do/0/review-brief` completed; `/do/1/ask-for-approval` waiting |
| `step_finished`          | The step “review brief” finished.                                              |                                                                  |
| `step_waiting`           | The step “ask for approval” waits for a function it called.                    |                                                                  |
| `workflow_input_applied` | A function the workflow called answered, and 1 step moved; the workflow ended. | `/do/1/ask-for-approval` completed                               |
| `step_finished`          | The step “ask for approval” finished.                                          |                                                                  |
| `run_succeeded`          | A run finished.                                                                |                                                                  |

Each event also carries `causation_id`, the `id` of the event that led to it, so the run can be drawn as a graph; each `step_waiting` names the run of the function it started, among them the run of `approve-campaign-brief` that held the request.

Read that run too:

> Read the run of `approve-campaign-brief` that you answered. Show its status, output and record.

Its record shows `answered_by`, the caller that answered, and `answered_at`. The tool's summary reads: The run of the interaction function “approve-campaign-brief” finished. Its answer: verdict: “approve” and note: “Approved for the autumn launch.”

## 9. Check that the request has ended

> Answer the same request again with the verdict `revise`, and show me the answer. Then list the open requests again.

The agent should report the answer refused with `conflict`, since the request was already answered with another answer, and the inbox empty: No request is waiting. The same answer again would answer the run as it stands. To ask again, start a new run of the workflow: it receives a new run id and uses the same definition versions.

## What was tested

Each call in this exercise was run against the runtime and its answers recorded. The statuses, fields, summaries, history and refusals in sections 1 and 3 to 9 are the ones observed. The model in that test was scripted to return one Revise review, so the test confirms the workflow's steps, its request and its answer, not a model's judgement of the brief.

## Review the saved workflow

The brain now contains a workflow that reviews a brief with a reasoning function and asks for an approval with an interaction function, and one recorded run of it. The review criteria live in the reasoning function, the question and the shape of its answer in the interaction function, and the workflow decides when each runs.

A request can also go to a person or a system outside the brain through a tool of a tool server, such as one that posts in a chat, which the function names in `deliver`; [Interaction function format](../reference/interaction-format.md) describes the document, sending through a tool, answering by reply and how a request ends, and [Workflows and runs](../concepts/workflows.md) explains how runs start, wait and end.

</div>
