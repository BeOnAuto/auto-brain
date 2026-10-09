# Troubleshooting

## Error responses

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document (`application/problem+json`) with a machine-readable `reason`, such as `bad_request`, `invalid_input` (with an `errors` list of JSON pointers), `forbidden`, `not_found` or `conflict`. A `500` says nothing about the cause; its `instance` is `urn:uuid:<id>`, and the server logs the error to stderr under `"incident":"<id>"` together with `"requestId"`, the value of the response's `x-request-id` header, so either id finds the log line. A request that Node's HTTP parser rejects before the API sees it, such as one with oversized headers or invalid framing, gets a bare status line, such as `431` or `400`, and no problem document.

## The model is unavailable

Check which providers the startup log names. Confirm the provider prefix in the definition, the configured credentials and the model id available to your account. The API deliberately hides missing settings and secrets from callers. See [Model providers](models.md).

## Workflows are missing or unavailable

Every server offers workflows and `send_run_event`, with nothing to configure. A workflow that does not go on is usually waiting: for an event, a timer or a function it called. When the server cannot do the work of its runs, it logs a warning saying what failed, such as `A sweep of the runs failed; the next sweep tries again`; [Workflow operations](workflows.md) lists them. When several servers share a database, one of them runs the workflows and the others answer workflow operations `unavailable`, saying another server runs them; the log of each server says which it is.

## The browser receives 403

Add the exact page origin to `ALLOWED_ORIGINS`. Local mode also checks the request Host. Never bypass these protections to expose local mode through a proxy. See [Authentication and security](security.md).

## Data disappeared after replacing a container

The ledger lives on `/data`. Reuse the named persistent volume across container replacements. An anonymous volume is not a persistence plan. See [Run in a container](container.md).

## A run stays started

A waiting workflow can legitimately remain `started`. Its history, `get_run_history`, shows the steps each input moved, and the last one shows what the run waits for. A run whose run the ledger would not settle yet also leaves it `started` until a later attempt settles it; the server warns once when such a run backs off to an attempt a minute, and once when it is settled. [Workflow operations](workflows.md) explains how a run ends.
