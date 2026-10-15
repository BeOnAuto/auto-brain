# campaign-pace

Spend, pace and projection per campaign, in cents, for a reporting period

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **rows** | yes | A list of at most 4,000 records with: **campaign** (text), **cost_cents** (a whole number, from 0 to 5,000,000), **budget_cents** (a whole number, from 0 to 1,000,000,000). |
| **period** | yes | A record with: **days_elapsed** (a whole number, from 1 to 366), **days_total** (a whole number, from 1 to 366). |

## What it produces

| Field | Required | What it is |
| --- | --- | --- |
| **campaigns** | yes | A list of records. |
| **total_spend_cents** | yes | A whole number. |

## How it computes

The program is TypeScript and is shown under Source.
