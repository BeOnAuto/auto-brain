# review-brief

Reviews a campaign brief against the team's criteria

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **brief** | yes | Text. |
| **criteria** | yes | Text. |

## What it produces

Text: the answer the model writes.

## Which model and tools

It reasons with the model `anthropic/claude-sonnet-4-5`.

It calls no tools.

## What it is told

Its instructions, which it follows on every run:

Review the brief using the supplied criteria. Identify missing evidence. Do not invent facts.

Its message, with the values of each run in place of the names in bold:

Brief: **brief**
Criteria: **criteria**
