# approve-draft

Send the draft to its owner in the chat and take their approval

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **owner** | yes | Text. |
| **draft** | yes | Text, at most 4,000 characters. |

## Who it asks

It asks a person, and each request goes to **owner**.

## What it sends

Its message, with the values of each run in place of the names in bold:

Here is the draft:

**draft**

Reply **approve**, or **revise** with a note of what to change.

## Where

It sends the request through the tool **post_message** of **chat**.

## How long it waits

It waits up to 2 days for the answer; a request nobody answers by then ends unanswered.

## What answer it expects

| Field | Required | What it is |
| --- | --- | --- |
| **verdict** | yes | One of: approve, revise. |
| **note** | no | Text, at most 2,000 characters. |

## Replies

It reads the replies to its message with the tool **thread_replies** of **chat**, and a reply from the party it goes to answers it when its reply rule reads it:

- **verdict**, from the first word of the reply: `approve` or `revise`
- **note**, from the words that follow the first

A reply the rule cannot read is refused, and the party is told how to answer.
