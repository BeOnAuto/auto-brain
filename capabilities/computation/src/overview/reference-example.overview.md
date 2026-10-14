# campaign-pace

Spend, pace and projection per campaign, in cents, for a reporting period

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **rows** | yes | A list of records with: **campaign** (text), **cost_cents** (a whole number), **budget_cents** (a whole number). |
| **period** | yes | A record with: **days_elapsed** (a whole number, at least 1), **days_total** (a whole number, at least 1). |

## What it produces

| Field | Required | What it is |
| --- | --- | --- |
| **campaigns** | yes | A list of records. |
| **total_spend_cents** | yes | A whole number. |

## How it computes

The program is TypeScript and is shown under Source.
