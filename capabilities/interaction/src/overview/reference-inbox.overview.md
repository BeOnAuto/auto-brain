# approve-brief

Asks the campaign owner to approve a reviewed brief

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **owner** | yes | Text. |
| **review** | yes | Text. |

## Who it asks

It asks a person, and each request goes to **owner**.

## What it sends

Its message, with the values of each run in place of the names in bold:

The review of your campaign brief is ready:

**review**

Approve the brief as it stands, or ask for a revision.

## Where

It leaves the request in the playbook's inbox, where a caller who may write to the playbook reads and answers it.

## How long it waits

It waits up to 2 days for the answer; a request nobody answers by then ends unanswered.

## What answer it expects

| Field | Required | What it is |
| --- | --- | --- |
| **verdict** | yes | One of: approve, revise. |
| **note** | no | Text, at most 2,000 characters. |
