# @on.auto/identity

Who calls the runtime: a key, the local developer, or a signed-in person an identity provider vouches for. `authenticatorFor` of `src/index.ts` takes the settings, the API keys, local mode and the issuers of the configured identity providers, and answers the access mode and an asynchronous `authenticate`, which takes the credential a request presents and the path of the MCP endpoint it reached, if any, and answers its `Authentication`: the `Principal` of the caller, or a `Refusal` whose `because` says why a token was refused, in words that name a rule or a claim and never a value of the token (`isRefusal` tells the two apart). A principal answers the caller of an org with `callerIn(org)`, or `undefined` for an org it does not admit: a key admits its own org, the local developer every org, and a signed-in person each org an entry of their issuer admits them to. The key command, `src/key-command.ts`, prints a new key once and the `API_KEYS` entry that admits it.

## Keys

A key is `abk_<id>_<secret>`, stored as the SHA-256 of the whole key with its org, permissions and playbooks, and verified in constant time. The org `local` is local mode's and the id `local` the local developer's, so `API_KEYS` and the key command refuse both.

## Signed-in persons

`readIdentityProviders` reads `IDENTITY_PROVIDERS`, and `IdentityProvidersSchema` is its entry list for the configuration file; each refusal names the entry and the field, or, for two entries that collide, the org and the issuer of each. `issuersOf` reads, at start, each issuer's metadata, from the addresses the MCP authorization specification orders, and its key set, each within 64 KiB and 10 seconds and following no redirect (`src/providers/issuer-requests.ts`), and stops with `UnusableProviderError` naming the provider when one cannot be used or its key set holds no keys.

The [`jose`](https://github.com/panva/jose) library verifies the tokens and keeps the key sets: `jwtVerify` checks the signature with the key of the token's `kid`, the algorithm among `RS256`, `PS256`, `ES256` and `EdDSA`, the issuer, the audience, `exp` and `nbf` with 60 seconds of leeway and that `exp` and `sub` are present; `createRemoteJWKSet` holds each issuer's key set, read through the bounded read above, read again for an unknown `kid` once 60 seconds have passed since the last read that succeeded, and at the first token after it is ten minutes old, `jose`'s default age, set in `src/providers/issuer-keys.ts`; a token whose key set cannot be read once it is ten minutes old is refused, never verified against the old one. The runtime checks itself what is its own rule (`src/tokens/token-verification.ts`): a token at most 8 KiB before anything is decoded, a `typ` of `at+jwt`, `application/at+jwt`, `JWT` or `application/jwt` or none, an `iat` at most 60 seconds ahead, a `sub` that is a non-empty string of at most 256 bytes, and the audiences a request may name, `PUBLIC_URL`, with a final `/` or not, and on an MCP endpoint that endpoint's URL. `src/providers/admitted-person.ts` then applies the entries of the issuer: the person is `person:<name>/<subject>` in each org whose entry's membership the token holds, under whose `subject` claim it names someone, and whose grants give it a permission. The security guide of the documentation sets out every rule.

`fakeIssuer` of `@on.auto/identity/testing` is an issuer for tests: it answers its metadata, its key set and a token endpoint for the client credentials grant, signs a token with `jose` and a key of each algorithm, and turns its keys over; `signedTokens` and `principalIn` help tests sign a token and read the person it admits.

## Measurement

`pnpm --filter @on.auto/identity measure` starts the issuers 200 times against the fake issuer answered in process, its metadata and a key set of four keys, and verifies 10,000 tokens of each algorithm one after another through `personOf`: the claimed issuer, the `jose` verification with its key, the runtime's own checks and the entries. In process, the start measures the runtime's own work; a provider's two round trips at start add their network time to it, and `jose` imports a key the first time a token names it. On Node v26.10.0 with 16 cores, on 2026-10-13, two runs:

| Measured                                      | Run 1   | Run 2   |
| --------------------------------------------- | ------- | ------- |
| Start: metadata and key set read              | 0.06 ms | 0.04 ms |
| Verification of an `RS256` token, per request | 32.3 µs | 30.7 µs |
| Verification of a `PS256` token, per request  | 32.8 µs | 31.6 µs |
| Verification of an `ES256` token, per request | 57.3 µs | 55.6 µs |
| Verification of an `EdDSA` token, per request | 56.0 µs | 55.5 µs |
