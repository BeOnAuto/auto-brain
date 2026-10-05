# Troubleshooting

## Error responses

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document (`application/problem+json`) with a machine-readable `reason`, such as `bad_request`, `invalid_input` (with an `errors` list of JSON pointers), `forbidden`, `not_found` or `conflict`. A `500` says nothing about the cause; its `instance` is `urn:uuid:<id>`, and the server logs the error to stderr under `"incident":"<id>"` together with `"requestId"`, the value of the response's `x-request-id` header, so either id finds the log line. A request that Node's HTTP parser rejects before the API sees it, such as one with oversized headers or invalid framing, gets a bare status line, such as `431` or `400`, and no problem document.

## The model is unavailable

Check which providers the startup log names. Confirm the provider prefix in the definition, the configured credentials and the model id available to your account. The API deliberately hides missing settings and secrets from callers. See [Model providers](models.md).

## Workflows are missing or unavailable

Workflow tools appear only when `TEMPORAL_ADDRESS` is configured. `pnpm dev` normally starts Temporal; `pnpm dev:lean` does not. A healthy HTTP endpoint does not prove the workflow worker is ready. Check for `The workflow worker started` and review [Temporal operations](temporal.md).

## The browser receives 403

Add the exact page origin to `ALLOWED_ORIGINS`. Local mode also checks the request Host. Never bypass these protections to expose local mode through a proxy. See [Authentication and security](security.md).

## Data disappeared after replacing a container

The ledger lives on `/data`. Reuse the named persistent volume across container replacements. An anonymous volume is not a persistence plan. See [Run in a container](container.md).

## A run stays started

A waiting workflow can legitimately remain `started`. Check its Temporal execution before retrying or cancelling. Interrupted executions and failures to settle can also leave this status; reconciliation is manual in this version. [Temporal operations](temporal.md) explains cancellation and termination.
