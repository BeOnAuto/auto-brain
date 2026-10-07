# @beonauto/outbound

How the server calls out to a system on the internet, where every caller keeps its own bounds: the outbound HTTP client of a delivery, the classification of a certificate the server does not trust, the Standard Webhooks signature of a body, and the answer token of a request. The reasoning function adapter and the MCP package take the certificate classification from here, and the interaction capability ([`@beonauto/interaction`](../../primitives/interaction)) the rest, as [decision 0010](../../docs/decisions/0010-interaction-functions.md) sets out. Streaming MCP and model responses are untouched: they keep their own clients and bounds.

## The outbound HTTP client

`postedOutbound({ url, headers, body, fetch?, timeoutMs? })` posts a body once and answers what came of it, never throwing:

| Outcome     | When                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `delivered` | a `2xx`, with its `status`, what came back as text, at most 64 KiB, its `bytes` and whether it was `cut`                                                                                                           |
| `failed`    | a `408`, a `429` with the wait its `Retry-After` asks, in seconds or as a date, as `retryAfterMs`, a `5xx`, a time out, a receiver unreachable, or a certificate the server does not trust: a delivery tries again |
| `refused`   | any other `4xx`, a redirect, which is never followed, a URL that is not `https` but on a loopback address (`isDeliverableUrl`), or a body over 240 KiB, refused before it is sent: a delivery does not try again   |

The call goes through `fetch`, Node's own unless one is given, so `NODE_USE_ENV_PROXY`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` apply, and gives up after `timeoutMs`, 10 s unless given, the reading of what came back included.

`outboundBounds` holds the bounds: five attempts of a delivery, the waits of 1, 2, 4 and 8 minutes between them, 240 KiB out, 64 KiB in and 10 s a call. `nextAttemptAt({ attempt, endedAt, retryAfterMs? })` answers when the attempt after one that ended is due, or nothing after the fifth: the wait of the schedule, or the longer wait a receiver asked for, never longer than the longest of the schedule, 8 minutes.

`isUntrustedCertificate(error)` says whether any of the causes of a failed call, eight deep at most, carries the code of a certificate the server does not trust, and `codesOf(error)` names those codes.

## Signing

`signedWebhookHeaders(secret, { id, timestamp, body })` signs a body as [Standard Webhooks](https://www.standardwebhooks.com/) signs one: `webhook-id`, `webhook-timestamp` in seconds, and `webhook-signature`, `v1,` and the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>` with the key of the secret. A secret is written `whsec_` and its key in base64, 24 to 64 bytes, which `webhookSecretProblem` checks; it is `Redacted` everywhere it is held. `isSignedWebhook(secret, { headers, body, nowSeconds })` is the receiver's check, of any of the signatures a request carries and of a time within five minutes, which the tests use.

`answerTokenOf(secret, messageId)` is the answer token of a request: the request's message id, a `.`, and the base64url HMAC-SHA256 of that id, with a key derived from the secret's for this purpose alone, the HMAC-SHA256 of `auto-brain answer token v1` with the secret's key, so a token is never a signature a webhook carries and a signature never a token. `requestOfAnswerToken(token)` reads the message id a token names, so a token can be checked against the secrets of a brain's channels before anything is read, and `answersRequest(secret, messageId, token)` checks that it names that request and compares its HMAC with the expected one in constant time. A token is never stored: it is made again from the secret and the request whenever it is needed.

## Testing

`@beonauto/outbound/testing` holds `serveFakeReceiver(path?)`, a receiver on a loopback port the system picks, which records every request with its headers and body and answers with the answers it is given, in turn (`answerWith`), or with one for every request (`answerEveryWith`), `204` until then, each after the delay it names.

## Source

`src/delivery` holds the client and the schedule, `src/signing` the signatures and the answer token, `src/certificates` the classification of certificates, and `src/testing` the fake receiver.
