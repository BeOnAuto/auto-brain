# Build your first workflow

Turn the campaign review from [Build your first brain](first-brain.md) into a workflow. It reviews a brief, waits for the revised brief, and reviews the revision. You will save the workflow, start a run, send the revised brief to the waiting run as an event, and read the finished run.

The campaign and figures below are sample data. This exercise makes no changes to advertising accounts or campaign budgets.

## Before you start

Complete [Build your first brain](first-brain.md) first. This exercise uses its practice brain, `campaign-review-tutorial`, and its reason function, `review-campaign-brief`, which takes one required input, `brief`.

Your agent needs a connection to a runtime that offers workflows, with permission to create and run definitions in that brain. [Functions and availability](../concepts/functions.md#availability) describes where workflows are available, and the first step below checks your connection.

## 1. Check that your connection offers workflows

Ask your connected agent:

> List the Auto tools you can call. Tell me whether `send_execution_event` is one of them, and which values the `primitive` field of `create_spec` accepts.

The agent should report `send_execution_event` among the tools, and `inference` and `orchestration` as the accepted primitives. `orchestration` is the API name for a workflow.

If `send_execution_event` is missing and `create_spec` accepts only `inference`, this connection's runtime does not offer workflows. Creating a workflow there is refused with `not_found` and the detail `There is no primitive orchestration`. Connect your agent to a runtime that offers workflows before continuing.

## 2. Confirm the reason function

Ask:

> In `campaign-review-tutorial`, read back the reason function `review-campaign-brief`. Show its version and the inputs it requires. Do not change it.

You should see `review-campaign-brief`, its version, and `brief` as its required input. If the function is missing, complete Build your first brain before continuing.

## 3. Save the workflow

The workflow has three steps. `review-first-brief` runs the reason function on the brief the run starts with. `wait-for-revision` waits for an event of type `com.example.brief.revised` and keeps the brief from its data. `review-revised-brief` runs the reason function again on that revised brief. The run's output keeps both reviews and the revised brief.

Send this instruction with the document that follows it:

> In `campaign-review-tutorial`, create a workflow named `review-brief-revision` from the document below. Use the document unchanged as the source, with the primitive `orchestration`. If a workflow with that name already exists, show it to me instead of changing it. Then show me the saved workflow's version, description and required input.

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-review-tutorial
  name: review-brief-revision
  version: '1.0.0'
  summary: Reviews a campaign brief, waits for the revised brief, then reviews the revision.
input:
  schema:
    document:
      type: object
      properties:
        brief: { type: string }
      required: [brief]
do:
  - review-first-brief:
      call: execute_spec
      with:
        primitive: inference
        name: review-campaign-brief
        input:
          brief: ${ .brief }
      output:
        as: '${ { first_review: . } }'
  - wait-for-revision:
      listen:
        to:
          one:
            with:
              type: com.example.brief.revised
      output:
        as: '${ $input + { revised_brief: .[0].brief } }'
  - review-revised-brief:
      call: execute_spec
      with:
        primitive: inference
        name: review-campaign-brief
        input:
          brief: ${ .revised_brief }
      output:
        as: '${ $input + { second_review: . } }'
```

The agent should confirm the workflow `review-brief-revision` at version 1, with the description from the document's `summary` and with `brief` as its required input. The tool's summary reads: Created the workflow “review-brief-revision”.

If the agent reports issues under `/source`, each gives a line and a column. Compare that line with the document above; [Workflow format](../reference/workflow-format.md) describes every field.

## 4. Start a run

Ask the agent to run the workflow with this text as the `brief` input:

```text
Campaign: Autumn reporting trial
Audience: Businesses that need better reporting
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: Generate interest in the product
```

> Run the workflow `review-brief-revision` in `campaign-review-tutorial` with the brief above as its `brief` input. Show me the run's execution id and status, and keep the execution id for the next steps.

The run should answer with an `execution_id` and `status: started`. The tool's summary reads: The workflow “review-brief-revision” has started and is still running. Its first step reviews the brief; then it waits for the revision.

Check it:

> Read the Auto run with that execution id and show its status.

It should still show `status: started`. A run that waits for an event stays started until the event arrives. The run does not show its steps or the first review yet; both appear in its output when it ends.

## 5. Send the revised brief

> Send the event `com.example.brief.revised` to that run. Its data is an object whose `brief` field is the text below. Show me what was delivered.

```text
Campaign: Autumn reporting trial
Audience: Finance directors at UK manufacturing companies with 50 to 250 employees
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: 100 trial registrations
```

The agent should report the event delivered, with its `type`, its `data`, an `id` the runtime assigned and the `time` it was sent. The tool's summary reads: Delivered the event “com.example.brief.revised” to the running workflow. The event goes to the waiting run; it does not start another one.

## 6. Read the finished run

> Read the run again until its status is no longer `started`. Show its status, definition version, finish time and output.

The run should show `status: succeeded`, `spec_version: 1`, a `finished_at` time and an output with three fields: `first_review`, `revised_brief` and `second_review`. `revised_brief` is the text you sent in step 5.

The two reviews come from your model, so their wording can vary. Check them against the expected findings from Build your first brain:

| Field           | Expected finding                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `first_review`  | Revise: the audience lacks a job role and type of company, and the success measure lacks a numeric target |
| `second_review` | Ready: all four criteria are met                                                                          |

A succeeded run means every step completed; it can still contain a Revise review. If the first review recommends Ready or the second Revise, inspect the reason function's prompt with your agent before relying on it.

## 7. Check that the run has ended

> Send the same event again to that run, and show me the answer.

The agent should report that the event was refused with `not_found` and the detail `The brain has no running workflow execution with that id`. Events reach only a run that is still going. To review another brief, start a new run: it receives a new execution id and uses the same definition version.

## What was tested

Each call in this exercise was run against the runtime and its answers recorded. The statuses, fields, summaries and refusals in steps 1 and 3 to 7 are the ones observed. The model in that test was scripted to return one Revise review and one Ready review, so the test confirms the workflow's steps and events, not a model's judgement of the briefs. The findings in step 6 are what a model following the review criteria should report.

## Review the saved workflow

The brain now contains a workflow that uses the reason function twice, around a person's revision, and one recorded run of it. The review criteria still live in the reason function; the workflow decides when it runs and what it waits for.

[Workflows and runs](../concepts/workflows.md) explains how runs start, wait and end, and [Workflow format](../reference/workflow-format.md) lists the steps you can add, such as a branch on a decision or a time limit on the wait.
