# read-campaign-costs

Reads the cost rows of every campaign for a month

## Who it asks

It asks a system: each run calls the tool **campaign-costs** of **ads** once.

## What it sends

It sends the tool the arguments its document writes, from each run's input:

| Field | Required | What it is |
| --- | --- | --- |
| **month** | yes | Text. |

## What it reads

It answers with what the tool answered under **rows**:

A list of records with: **campaign** (text), **cost_cents** (a whole number), **budget_cents** (a whole number).
