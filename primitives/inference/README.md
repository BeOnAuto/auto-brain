# @beonauto/inference

Inference is the primitive of a brain that calls a language model. A spec of inference names a model, gives it instructions and a prompt built from what the brain knows, and says whether the answer is free text or a JSON value that must match a JSON Schema. Each execution sends one request to the model and records the answer, the tokens it used and how it finished. This package calls the models through the Vercel AI SDK, behind a small interface of its own, so that every provider below works from settings alone, in Auto's cloud hosting and in a self-hosted container. auto-brain is source-available under the Elastic License 2.0.

This document covers the model calls. The spec document format and the operations come in the sections marked at the end.

## How a model reference is resolved

A spec names its model as `provider/model`, for example `anthropic/claude-sonnet-4-5` or `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`.

1. If `MODEL_ALIASES` maps the reference to another one, the other one is used. An alias resolves in one hop.
2. The reference is split at its first `/`. The part before it is the provider, everything after it is the model id the provider receives, unchanged (Bedrock ARNs keep their own `/`).
3. The provider must be configured (see the table below). A reference without a `/`, or with nothing on either side of it, is `spec_invalid` and nothing is sent.

There is no default provider. A model id without a provider never reaches a default gateway: the package replaces the AI SDK's global default provider with one that has no models.

## Providers

A provider is configured when its required settings are present. One that is not configured is simply absent; a spec that names it fails with `provider_not_configured`, which lists the settings it lacks.

| Prefix              | Calls                                          | Required settings                                                      | Optional settings                                                                                   | In the default image                             |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `anthropic`         | Anthropic Messages API                         | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` (sent as a bearer token) | `ANTHROPIC_BASE_URL`                                                                                | Yes                                              |
| `openai`            | OpenAI Responses API                           | `OPENAI_API_KEY`                                                       | `OPENAI_BASE_URL`; `OPENAI_API=chat_completions` for endpoints that only implement Chat Completions | Yes                                              |
| `google`            | Gemini API                                     | `GOOGLE_GENERATIVE_AI_API_KEY`                                         |                                                                                                     | Yes                                              |
| `bedrock`           | Amazon Bedrock Converse API                    | `AWS_REGION`                                                           | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL`                  | Yes                                              |
| `bedrock-anthropic` | Anthropic models through Bedrock InvokeModel   | as `bedrock`                                                           | as `bedrock`                                                                                        | Yes                                              |
| `azure`             | Azure OpenAI Responses API                     | `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, and `AZURE_API_KEY`         | `AZURE_API_VERSION`                                                                                 | Yes                                              |
| `azure` with Entra  | as `azure`, with a Microsoft Entra ID token    | `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, no `AZURE_API_KEY`          | `AZURE_API_VERSION`                                                                                 | No: needs the optional package `@azure/identity` |
| `vertex`            | Gemini on Google Vertex AI                     | `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                      |                                                                                                     | Yes                                              |
| `vertex-anthropic`  | Anthropic models on Google Vertex AI           | as `vertex`                                                            |                                                                                                     | Yes                                              |
| a gateway's name    | an OpenAI-compatible Chat Completions endpoint | an entry in `MODEL_GATEWAYS`                                           |                                                                                                     | Yes                                              |

Credentials:

- **Bedrock** signs every request with credentials from the AWS default provider chain: environment variables, IAM roles for service accounts (a web identity token file), EKS Pod Identity and ECS task roles (a container credentials endpoint), instance roles, shared profiles and SSO. `AWS_BEARER_TOKEN_BEDROCK`, when set, is sent instead. The chain reads its own variables (`AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE` and the rest) as the AWS SDK documents them.
- **Vertex** uses Google application default credentials: workload identity, an attached service account, or the file named by `GOOGLE_APPLICATION_CREDENTIALS`.
- **Azure** without `AZURE_API_KEY` uses Microsoft Entra ID through `DefaultAzureCredential` of `@azure/identity`, with the scope `https://cognitiveservices.azure.com/.default`.

The settings are read once, when the server starts. A malformed value stops the start with `model_settings_invalid`, which names every setting at fault and never repeats a value.

## Deployment shapes

Each section shows the settings a deployment needs and nothing else.

### Direct API keys

```sh
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Specs then name `anthropic/claude-sonnet-4-5`, `openai/gpt-5` or `google/gemini-2.5-flash`.

### Amazon Bedrock with an IAM role

Give the workload a role that may call `bedrock:InvokeModel` (IAM roles for service accounts or EKS Pod Identity on Kubernetes, a task role on ECS, an instance profile on EC2), then set only the region:

```sh
AWS_REGION=eu-central-1
```

To reach Bedrock through a VPC endpoint, add:

```sh
AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://vpce-0123456789abcdef0-abcdefgh.bedrock-runtime.eu-central-1.vpce.amazonaws.com
```

Specs name `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`, or `bedrock-anthropic/<the same id>` to use Anthropic's own request format through InvokeModel, which also accepts application inference profile ARNs.

### Azure OpenAI with an API key

```sh
AZURE_RESOURCE_NAME=acme-openai
AZURE_API_KEY=...
```

Specs name the deployment: `azure/gpt-5-production`. To address the resource by URL, set `AZURE_BASE_URL=https://acme-openai.openai.azure.com/openai` in place of `AZURE_RESOURCE_NAME`, and optionally `AZURE_API_VERSION`. When `AZURE_BASE_URL` is a host outside Azure, such as an API Management gateway, requests go to `<AZURE_BASE_URL>/responses` without an `api-version`; the gateway owns the path and version.

### Azure OpenAI with Microsoft Entra ID (opt-in)

Microsoft Entra ID needs `@azure/identity` (about 43 MB), which is an optional dependency and not in the default image. Build the image with it:

```sh
docker build --build-arg OPTIONAL_DEPENDENCIES=include --file packages/server/Dockerfile --tag auto-brain:entra .
```

The image's dependency install leaves out every optional dependency unless `OPTIONAL_DEPENDENCIES=include`; today the only one is `@azure/identity`, at the exact version `primitives/inference/package.json` pins. Then give the workload an identity with the role _Cognitive Services OpenAI User_ on the resource (Azure workload identity on AKS, or a managed identity), and leave `AZURE_API_KEY` unset:

```sh
AZURE_RESOURCE_NAME=acme-openai
```

On AKS, the workload identity webhook sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_FEDERATED_TOKEN_FILE`, which `DefaultAzureCredential` reads. Without the package, `azure` is reported as not configured, naming `AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID`; nothing fails at start.

### Google Vertex AI with workload identity

Bind the Kubernetes service account to a Google service account with the role _Vertex AI User_, then set:

```sh
GOOGLE_VERTEX_PROJECT=acme-ai
GOOGLE_VERTEX_LOCATION=europe-west4
```

Outside Kubernetes, `GOOGLE_APPLICATION_CREDENTIALS=/var/run/secrets/google/credentials.json` names a credentials file instead. Specs name `vertex/gemini-2.5-flash` or `vertex-anthropic/claude-sonnet-4-5`. A `vertex-anthropic` call reads the access token twice, because the AI SDK's Anthropic model resolves its headers twice per request; the token client caches it, so this costs no extra exchange.

### An internal OpenAI-compatible gateway with a custom header

```sh
MODEL_GATEWAYS='[{"name":"internal","base_url":"https://llm.internal.example/v1","api_key_env":"INTERNAL_LLM_KEY","headers":{"x-tenant":"acme"},"structured_outputs":true}]'
INTERNAL_LLM_KEY=...
```

Specs name `internal/llama-3.3-70b`. Each entry of `MODEL_GATEWAYS` has:

| Field                | Required | Meaning                                                                                                                                                            |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`               | Yes      | The provider prefix: 1 to 32 lowercase letters, digits and hyphens, starting with a letter, unique, and not one of the built-in prefixes                           |
| `base_url`           | Yes      | The http or https URL that `/chat/completions` is appended to                                                                                                      |
| `api_key_env`        | No       | The name of the variable that holds the key, sent as `Authorization: Bearer <key>`; it must be set                                                                 |
| `headers`            | No       | Headers sent with every request; their values are treated as secrets                                                                                               |
| `query_params`       | No       | Query parameters added to every request; their values are treated as secrets                                                                                       |
| `structured_outputs` | No       | `true` when the endpoint accepts `response_format: json_schema`; otherwise JSON is asked for as `json_object` and the schema is only checked here. Default `false` |
| `include_usage`      | No       | Asks for usage in streamed responses. Default `false`                                                                                                              |

### Behind an outbound proxy with a private certificate authority

Node.js 26 needs no code for either:

```sh
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://proxy.internal.example:3128
NO_PROXY=localhost,127.0.0.1,169.254.169.254,169.254.170.2,169.254.170.23,metadata.google.internal,.svc.cluster.local
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/internal-ca.pem
```

- `NODE_USE_ENV_PROXY=1` makes Node's `fetch` and its default HTTP agents use `HTTPS_PROXY` and `NO_PROXY`. Every model call goes through it.
- The AWS credential chain makes its STS and SSO calls with agents of its own; when `NODE_USE_ENV_PROXY=1` is set, this package gives them the same proxy settings.
- Google's token client reads `HTTPS_PROXY` and `NO_PROXY` itself and matches `NO_PROXY` entries only as exact host names or as suffixes that start with `.`; write the entries that way. Azure's identity library reads them itself too.
- The cloud credential endpoints must not go through the proxy: `169.254.169.254` (EC2, GCE and Azure instance metadata), `169.254.170.2` (ECS task roles), `169.254.170.23` (EKS Pod Identity) and `metadata.google.internal`.
- `NODE_EXTRA_CA_CERTS` adds the certificate authority to every TLS connection Node makes. A certificate that is still not trusted fails as `provider_not_configured` naming `NODE_EXTRA_CA_CERTS`, and is never retried.

Mutual TLS to the model endpoints is not supported.

## Model aliases

`MODEL_ALIASES` is a JSON object from one reference to another. It lets specs keep a name while the deployment decides where it runs:

```sh
MODEL_ALIASES='{"anthropic/claude-haiku-4-5":"bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0","fast/default":"google/gemini-2.5-flash"}'
```

Both sides are written `provider/model`. A target may not itself be an alias, so cycles and chains are rejected when the server starts. The result of a call records the model as requested, as resolved, and as the provider answered.

## When a provider is not configured

Nothing fails at start. A spec that names the provider fails with `provider_not_configured`:

```json
{
  "_tag": "provider_not_configured",
  "detail": "openai is not configured; it needs OPENAI_API_KEY",
  "provider": "openai",
  "configured": ["anthropic", "bedrock", "bedrock-anthropic"],
  "missing": ["OPENAI_API_KEY"]
}
```

A prefix nobody configures, such as `mistral`, says `There is no provider named mistral` and lists the configured ones. `makeModelAccess` also returns a `status` for start-up logging: the configured prefixes, and for each unconfigured built-in provider the names of the settings it lacks.

## Failures

Every failure has a `_tag`, a `detail` safe to show the caller, and the `provider` prefix (or `null` when none was resolved). None carries anything from the prompt or the answer, except where the table says so.

| Failure                   | When                                                                                                                                                                                                                                                                                                                                                                                                                                | Also carries                                                                                                                                                                                                                                                                            | What the caller can do                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `spec_invalid`            | The model is not written `provider/model`; the request is invalid (no messages, `max_output_tokens` not an integer of 1 or more, `temperature` or `top_p` not finite, `seed` not an integer of 0 or more, `timeout_ms` not an integer of 1 or more); the output schema cannot be read; the provider answered HTTP 400, 404, 413, 422 or another 4xx not listed below; the SDK refused a setting, the prompt, a feature or the model | `status`, `issues` with JSON pointers into the request, and `provider_message`: the provider's own error message, at most 1000 characters, left out when it is empty, holds the raw response body, or is itself a JSON, HTML or XML document. It describes the request and can quote it | Fix the spec                                      |
| `provider_not_configured` | The prefix is unknown; the provider's settings are missing (including Azure without a key and without `@azure/identity`); the provider's TLS certificate is not trusted                                                                                                                                                                                                                                                             | `configured` prefixes, `missing` setting names                                                                                                                                                                                                                                          | Fix the settings                                  |
| `credentials_rejected`    | HTTP 401 or 403; no credential could be obtained from the AWS chain, Google application default credentials or Microsoft Entra ID                                                                                                                                                                                                                                                                                                   | `status` (`null` when the credential source failed)                                                                                                                                                                                                                                     | Fix the credentials or the role                   |
| `rate_limited`            | HTTP 429                                                                                                                                                                                                                                                                                                                                                                                                                            | `retry_after_ms` from `retry-after-ms`, or `retry-after` in seconds or as a date; `null` without a hint                                                                                                                                                                                 | Retry after the delay                             |
| `provider_unavailable`    | HTTP 408, 409 or 5xx (including 529); the connection failed; a 2xx response could not be read                                                                                                                                                                                                                                                                                                                                       | `status` (`null` when there was no response)                                                                                                                                                                                                                                            | Retry later                                       |
| `content_refused`         | The provider refused the request under its content policy (HTTP 400 with the error code `content_filter` or `content_policy_violation`), or stopped the answer for it                                                                                                                                                                                                                                                               | `status`, `raw_finish_reason`, `usage`                                                                                                                                                                                                                                                  | Change the input                                  |
| `output_invalid`          | JSON was asked for and the answer is not JSON, does not match the schema, or was cut off at `max_output_tokens`                                                                                                                                                                                                                                                                                                                     | `finish_reason`, `raw_finish_reason`, `usage`, and `issues` with JSON pointers into the answer and Effect's messages, which never quote the answer                                                                                                                                      | Retry, raise the token limit, or relax the schema |
| `timed_out`               | `timeout_ms` passed before the provider answered                                                                                                                                                                                                                                                                                                                                                                                    | `timeout_ms`                                                                                                                                                                                                                                                                            | Retry, or allow more time                         |
| `cancelled`               | The caller's `signal` aborted                                                                                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                         | Nothing                                           |

A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"`. A failure this package does not recognise is a defect: the call dies with `UnclassifiedModelError`, which names the provider and the kind of error and nothing else.

### Retries

With `retries: 'adapter'`, the default, a call that fails with HTTP 408, 409, 429 or 5xx, or cannot connect, is tried up to twice more, after 2 and then 4 seconds, or after the provider's `retry-after` when it asks for less than a minute. A caller that retries on its own, such as a workflow engine, passes `retries: 'caller'`, and exactly one request is made. `timeout_ms` covers all attempts. An untrusted certificate is never retried.

## What is recorded, and what is never logged

A result carries `text`; `json` when JSON was asked for; `finish_reason` (`stop`, `length`, `content_filter`, `tool_calls`, `error` or `other`) and the provider's `raw_finish_reason`; `usage` (input tokens, of which uncached, cache read and cache write; output tokens, of which text and reasoning; and the total, each `null` when the provider did not say); the `model` as requested, as resolved and as answered; the provider's `response_id` (Bedrock's request id); `warnings` from the provider, such as a setting a model ignores; and `duration_ms`. The execution that runs a spec records the result.

This package logs nothing. It never returns, and no failure or defect carries:

- the request or response bodies the SDK keeps on its errors (`requestBodyValues`, `responseBody`, `data`), the errors of earlier attempts (`RetryError.errors`), or the texts and values on parse and validation errors, which hold the prompt or the answer;
- an API key, token or secret header: settings keep secrets redacted, and a settings error names the setting, never its value;
- the SDK's own error objects.

The SDK's warnings are not written to the console; they arrive in `warnings`.

## Answers that are JSON

An answer schema is a JSON Schema document, draft 2020-12, or draft-07 when `$schema` says so or the document uses `definitions` without `$defs`. `compileAnswerSchema(document)` checks it and gives an `AnswerSchema`, or issues with JSON pointers into the document. The answer is validated here, against the schema as written, whatever the provider enforced. The validator is Effect's JSON Schema importer: it compiles a schema into data, not code, and it refuses regular expressions.

Limits on schemas, which the spec author controls:

- at most 65,536 bytes as JSON, at most 64 nested levels of objects and lists, at most 1000 values in one `enum`;
- no `pattern` or `patternProperties`, because a hostile regular expression can stall validation;
- no `if`, `then`, `else`, `contains`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedItems`, `unevaluatedProperties`, `additionalItems` or dynamic anchors; `$ref` only to `#/$defs/<name>` or `#/definitions/<name>`; `not` only as `{}`; `enum` and `const` only of strings, numbers, booleans and null; a schema for `additionalProperties` not together with `properties`.

Limits on answers: at most 128 nested levels; at most 100 issues are reported.

`checkAnswerSchema(document)` is the check a spec author needs when a document is stored. It reports:

- `unsupported`: what makes the schema unusable here, as above;
- `not_portable`: what some providers reject or do not enforce, with the prefixes concerned;
- `unchecked`: what is sent to the provider but not checked here, such as `format` and keywords this package does not know.

The portable subset, from the providers' packages:

- The root is `"type": "object"`. OpenAI and Azure strict structured outputs, and providers that answer through a JSON tool, take only an object.
- Every object sets `"additionalProperties": false` and lists every property in `required`; an optional property is written as nullable (`"type": ["string", "null"]`). OpenAI and Azure use strict structured outputs and reject anything else.
- Numeric, length and count bounds (`minimum`, `maxLength`, `minItems`, `uniqueItems` and the like) are removed from the schema Anthropic models decode against. They are still checked here, so an answer outside them fails as `output_invalid`. The same holds for `oneOf`, which Anthropic models receive as `anyOf`.
- Anthropic models accept the formats `date-time`, `time`, `date`, `duration`, `email`, `hostname`, `uri`, `ipv4`, `ipv6` and `uuid`.
- Google notes that very large or deeply nested schemas may be rejected.

How each provider is asked for JSON: Anthropic models with native structured output receive `output_config.format`, older ones a forced `json` tool; OpenAI and Azure receive a strict `json_schema` format; Gemini receives `responseJsonSchema`; Bedrock uses native structured output for the Anthropic models that support it and a forced `json` tool otherwise; a gateway receives `response_format`.

## Using it from code

```ts
import { compileAnswerSchema, LanguageModel, languageModelLayer } from '@beonauto/inference';
import { Effect, Result } from 'effect';

const schema = Result.getOrThrow(
  compileAnswerSchema({
    type: 'object',
    properties: { verdict: { enum: ['approve', 'reject'] } },
    required: ['verdict'],
    additionalProperties: false,
  }),
);

const decide = Effect.gen(function* () {
  const model = yield* LanguageModel;
  return yield* model.generate({
    model: 'anthropic/claude-sonnet-4-5',
    instructions: 'Decide whether the expense follows the policy.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Dinner for four, 312 EUR, client present.' }] }],
    output: { type: 'json', schema, name: 'verdict' },
    settings: { max_output_tokens: 200 },
    timeout_ms: 30_000,
  });
});

Effect.runPromise(decide.pipe(Effect.provide(languageModelLayer(process.env))));
```

A request has `model`, optional `instructions`, `messages` (roles `user` and `assistant`, each with text parts), `output`, `settings` (`max_output_tokens`, and optionally `temperature`, `top_p`, `seed`, `stop_sequences` and `reasoning`), optional `provider_options`, `timeout_ms`, `signal` and `retries`. Some providers drop sampling settings for newer models and say so in `warnings`. `provider_options` passes options to the provider unchanged, keyed by the AI SDK's namespace for it: `anthropic`, `openai`, `azure`, `google`, `googleVertex`, `amazonBedrock`, or the gateway's name. `requestIssues(request)` gives the problems of a request before it is sent.

`makeModelAccess(settings, options)` builds the same model and also returns `status`. Its options inject a `fetch` and credential sources (`aws`, `google`, `azure`), which is how tests run without a network and how per-tenant credentials will be added.

## Testing

`@beonauto/inference/testing` exports a fake for the tests of other packages. `scriptedLanguageModel(...replies)` answers with its replies in order, rejects an invalid request as the real one does, records every request (`requests()`), and provides itself as a `layer`. A reply is a function of the request; `answers(textResult('Hello'))` and `answers(jsonResult({ verdict: 'approve' }))` build the usual ones, and `() => Effect.fail(new RateLimited({ ... }))` scripts a failure.

No test in this package calls a model: the adapter is tested with the AI SDK's mock model and with the real provider packages against a fake `fetch` that answers with each provider's documented response shape.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/model` holds the interface: the request, the result, the `LanguageModel` service and the request checks. `src/failure` holds one class per failure. `src/schema` holds answer schemas: limits, the shape check, compilation, validation and portability. `src/settings` reads the settings from the environment with Effect `Config`. `src/adapter` is the only production code that imports the AI SDK and the cloud credential libraries. `src/testing` holds the fake and what the tests share, including the SDK's mock model.

## The spec document format

To come: how an inference spec is written, with its front matter and its template.

## Creating and executing a spec

To come: the operations that store an inference spec and run it.

## An example from start to finish

To come: a spec created and executed with `curl`.
