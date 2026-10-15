# approve-brief

Ask the campaign's owner to approve a brief

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **campaign** | yes | Text. |
| **owner** | yes | Text. |
| **summary** | yes | Text, at most 4,000 characters. |

## Who it asks

It asks a person, and each request goes to **owner**.

## What it sends

Its message, with the values of each run in place of the names in bold:

Please review the brief for **campaign**.

**summary**

## Where

It leaves the request in the playbook's inbox, where a caller who may write to the playbook reads and answers it.

## How long it waits

It waits up to 2 days for the answer; a request nobody answers by then ends unanswered.

## What answer it expects

| Field | Required | What it is |
| --- | --- | --- |
| **choice** | yes | One of: approve, reject. |
| **note** | no | Text, at most 2,000 characters. |
