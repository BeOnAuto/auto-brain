# queue-hours

Estimates the hours each support queue needs next week, with a range for each

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **tickets** | yes | The open tickets, one a line, each with its queue. Text. |

## What it produces

It answers 1 to 200 **values**, in **unit**, each a **value** under a **name** of its own, with a **low** and a **high** where given.

## Which model and tools

It reasons with the model `anthropic/claude-sonnet-4-5`.

It calls no tools.

## What it is told

Its instructions, which it follows on every run:

Estimate from the tickets alone. Name each queue as the tickets name it.

Its message, with the values of each run in place of the names in bold:

For each queue, estimate the hours its team needs next week, with a low and a high, in the unit hours.

**tickets**
