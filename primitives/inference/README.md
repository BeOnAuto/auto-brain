# @beonauto/inference

Inference is the primitive through which a brain reasons: it calls a language model. A spec of inference, which a person calls a reason function, names a model, gives it instructions and a prompt built from what the brain knows, and says whether the answer is free text or a JSON value that must match a JSON Schema. Each execution sends one request to the model and records the answer, the tokens it used and how it finished. This package calls the models through the Vercel AI SDK, behind a small interface of its own, so that every provider below works from settings alone, in Auto's cloud hosting and in a self-hosted container. auto-brain is source-available under the Elastic License 2.0.

The first half of this document covers how models are called and configured; the second half, from [The spec document format](#the-spec-document-format), how a spec is written, created and executed.

## How a model reference is resolved

A spec names its model as `provider/model`, for example `anthropic/claude-sonnet-4-5` or `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`.

1. If the aliases (`model_aliases` in the configuration file, or `MODEL_ALIASES`) map the reference to another one, the other one is used: an exact alias first, then the wildcard alias with the longest prefix, such as `anthropic/*` (see [Model aliases](#model-aliases)). An alias resolves in one hop.
2. The reference is split at its first `/`. The part before it is the provider, everything after it is the model id the provider receives, unchanged (Bedrock ARNs keep their own `/`). A reference without a `/`, or with nothing on either side of it, is `spec_invalid` and nothing is sent.
3. When `allowed_models` is set, the reference as the spec writes it must be one of its entries, or start with the part before the `*` of one of them; otherwise it fails as `model_not_allowed` and nothing is sent (see [Listing the models](#listing-the-models)).
4. The provider must be configured (see the table below).

There is no default provider. A model id without a provider never reaches a default gateway: the package replaces the AI SDK's global default provider with one that has no models.

## Providers

A provider is configured when its required settings are present. One that is not configured is simply absent; a spec that names it fails with `provider_not_configured`, which names the providers that are configured. The settings a provider lacks are an operator's business: the server's start-up log names them, and the caller of a spec never sees them.

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
| a gateway's name    | an OpenAI-compatible Chat Completions endpoint | an entry in `model_gateways` or `MODEL_GATEWAYS`                       |                                                                                                     | Yes                                              |

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

Microsoft Entra ID needs `@azure/identity`, an optional dependency of this package that is not in the default image. Build the image with it:

```sh
docker build --build-arg AZURE_IDENTITY=true --file packages/server/Dockerfile --tag auto-brain:entra .
```

`AZURE_IDENTITY=true` adds `@azure/identity`, at the exact version `primitives/inference/package.json` pins, and nothing else: the other optional packages of the server's dependencies, such as the telemetry exporters of the ledger's libraries, stay out. Measured on arm64, the default image is 402 MB and this one 426 MB. Any value but `true` or `false` stops the build. Then give the workload an identity with the role _Cognitive Services OpenAI User_ on the resource (Azure workload identity on AKS, or a managed identity), and leave `AZURE_API_KEY` unset:

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

In the server's [configuration file](../../README.md#configuring-a-model):

```yaml
model_gateways:
  - name: internal
    base_url: https://llm.internal.example/v1
    api_key: ${INTERNAL_LLM_KEY}
    headers:
      x-tenant: acme
    structured_outputs: true
```

with `INTERNAL_LLM_KEY` set in the environment. The same, as an environment variable, which wins over the file's `model_gateways` when both are set:

```sh
MODEL_GATEWAYS='[{"name":"internal","base_url":"https://llm.internal.example/v1","api_key_env":"INTERNAL_LLM_KEY","headers":{"x-tenant":"acme"},"structured_outputs":true}]'
INTERNAL_LLM_KEY=...
```

Specs name `internal/llama-3.3-70b`. Each gateway has:

| Field                      | Required | Meaning                                                                                                                                                                                                                                                         |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Yes      | The provider prefix: 1 to 32 lowercase letters, digits and hyphens, starting with a letter, unique, and not one of the built-in prefixes                                                                                                                        |
| `base_url`                 | Yes      | The http or https URL that `/chat/completions` is appended to                                                                                                                                                                                                   |
| `api_key`                  | No       | The key, sent as `Authorization: Bearer <key>`. In the file, a reference to the variable that holds it, such as `${INTERNAL_LLM_KEY}`                                                                                                                           |
| `api_key_env`              | No       | In `MODEL_GATEWAYS` only, instead of `api_key`: the name of the variable that holds the key; it must be set                                                                                                                                                     |
| `headers`                  | No       | Headers sent with every request; their values are treated as secrets. In the file, a header that carries a credential, such as `authorization`, is a reference                                                                                                  |
| `query_params`             | No       | Query parameters added to every request; their values are treated as secrets                                                                                                                                                                                    |
| `structured_outputs`       | No       | `true` when the endpoint accepts `response_format: json_schema`; otherwise JSON is asked for as `json_object` and the schema is only checked here. Default `false`                                                                                              |
| `include_usage`            | No       | Asks for usage in streamed responses. Default `false`                                                                                                                                                                                                           |
| `expose_provider_messages` | No       | `true` when the gateway's error messages are safe to show to the callers of a spec. Default `false`: callers get only the provider prefix, the HTTP status and what it means, and the message goes to the operator; see [Provider messages](#provider-messages) |
| `allowed_provider_options` | No       | The top-level request body fields a spec may set for this gateway through `provider_options`, for example `["user", "metadata"]`. Default none; see [Provider options](#provider-options)                                                                       |

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
- `NODE_EXTRA_CA_CERTS` adds the certificate authority to every TLS connection Node makes. A certificate that is still not trusted fails as `provider_not_configured`, and is never retried. The caller is told that the provider's certificate is not trusted by this server and that its operator must add the certificate authority; the operator gets the hint naming `NODE_EXTRA_CA_CERTS` (see [Operator hints](#operator-hints)).

Mutual TLS to the model endpoints is not supported.

## Model aliases

`model_aliases` in the server's [configuration file](../../README.md#configuring-a-model) maps one reference to another. It lets specs keep a name while the deployment decides where it runs:

```yaml
model_aliases:
  anthropic/claude-haiku-4-5: bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0
  fast/default: google/gemini-2.5-flash
```

The same, as an environment variable, which wins over the file's `model_aliases` when both are set:

```sh
MODEL_ALIASES='{"anthropic/claude-haiku-4-5":"bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0","fast/default":"google/gemini-2.5-flash"}'
```

Both sides are written `provider/model`. A target may not itself be an alias, so cycles and chains are rejected when the server starts. The result of a call records the model as requested, as resolved, and as the provider answered.

A trailing `*` on both sides makes a wildcard alias, which sends every model of a provider through a gateway. With only a gateway configured, a spec that names `anthropic/claude-sonnet-4-5` reaches it as `gateway/anthropic/claude-sonnet-4-5` with:

```yaml
model_aliases:
  anthropic/*: gateway/anthropic/*
```

or `MODEL_ALIASES='{"anthropic/*":"gateway/anthropic/*"}'`.

For a gateway that names models without the provider's prefix, the target is `gateway/*`. The `*` stands once, at the end of both sides, for the rest of the reference, which may not be empty. An exact alias wins over a wildcard, and among wildcards the longest prefix wins. A wildcard target may not reach another alias either, so `{"anthropic/*":"gateway/*","gateway/fast":"gateway/llama-3.3-70b"}` is rejected when the server starts. A provider reached only through a wildcard alias is not a configured provider: with the alias above, `anthropic` stays unconfigured in `status` and in the start-up log.

The description of inference that the spec tools carry lists the alias names as they are written, `anthropic/*` included, and says that a spec may give any `anthropic/<model id>`, so an agent writing a spec sees them.

## Listing the models

`list_models` lists the models this server can call, so an agent can name one that works instead of guessing. It is an org query: `GET /v1/orgs/{org}/models` over HTTP, and the read-only tool `list_models` on `/mcp` and `/orgs/{org}/mcp`, for any caller with `org:read`. `defineListModels(catalog)` defines it from the `catalog` that `makeModelAccess` returns. Its optional input `provider`, a provider prefix such as `anthropic` or a gateway's name, lists only what that provider serves and asks no other provider.

It answers in the shape of the OpenAI API's list of models, the shape OpenAI, Azure, LiteLLM, Portkey and Vercel's gateway answer in, with two fields of its own at the top:

```json
{
  "object": "list",
  "data": [
    {
      "id": "anthropic/claude-sonnet-4-5-20250929",
      "object": "model",
      "created": 1759104000,
      "owned_by": "anthropic",
      "name": "Claude Sonnet 4.5",
      "context_window": 200000,
      "max_tokens": 64000
    },
    {
      "id": "gateway/anthropic/claude-haiku-4-5",
      "object": "model",
      "created": 1760486400,
      "owned_by": "gateway",
      "name": "Claude Haiku 4.5",
      "context_window": 200000,
      "max_tokens": 64000
    },
    {
      "id": "house/fast",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "resolved_to": "gateway/anthropic/claude-haiku-4-5"
    },
    {
      "id": "openai/*",
      "object": "model",
      "created": 0,
      "owned_by": "gateway",
      "resolved_to": "gateway/openai/*",
      "pattern": true
    },
    { "id": "bedrock/*", "object": "model", "created": 0, "owned_by": "bedrock", "pattern": true }
  ],
  "catalog_status": "complete",
  "listed_at": "2026-10-01T09:30:00.000Z"
}
```

| Field            | Meaning                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | The model as a spec names it: `<provider>/<model id>`, or an alias as its operator wrote it                                                           |
| `created`        | When the provider released or added the model, in seconds since 1970, as the provider says; 0 when it does not                                        |
| `owned_by`       | The provider prefix that serves the model; for an alias, the prefix of its target. Never the owner a provider reports, which can name an organisation |
| `name`           | The provider's name for the model, only when it reports one                                                                                           |
| `context_window` | The most input tokens, only when the provider reports it                                                                                              |
| `max_tokens`     | The most output tokens, only when the provider reports it                                                                                             |
| `resolved_to`    | For an alias, the reference it is sent to; left out when that is a Bedrock ARN, which names an account and a region                                   |
| `pattern`        | `true` for an id that ends in `*`, which stands for any model id: a wildcard alias, or a provider that lists nothing and has no declared models       |
| `catalog_status` | `partial` when a provider could not be asked, so its models are missing or are its last list; `complete` otherwise                                    |
| `listed_at`      | When the oldest list in the answer was read from its provider; the time of the answer when none was read                                              |

The entries are sorted by `id`, each `id` once. A model an alias sends elsewhere is left out, since a spec that names it reaches the alias: with `anthropic/*` sent to a gateway, the models Anthropic lists are not listed, and `anthropic/*` is.

Its plain words name the models by the name their provider gives, or by the last part of the id, twenty at most, and say which providers take any model id and when the list may be incomplete: `This server can call 6 models through anthropic and gateway: Claude Haiku 4.5, Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5, and fast.`

### Where each list comes from

Each list is read with the credentials and endpoint the server calls the provider with, through the same `fetch`, so `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` apply. A page is read within 10 seconds and 8 MiB, and a list of more than 10 pages is not read.

| Provider                                                              | List                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anthropic`                                                           | `GET <base URL>/models?limit=1000` and its next pages, with the key or token and `anthropic-version: 2023-06-01`; `display_name`, `created_at`, `max_input_tokens` and `max_tokens` give the details                                                                                                   |
| `openai`                                                              | `GET <base URL>/models` with the key, without the ids that by OpenAI's naming are not for a conversation: fine-tunes (`ft:`), embeddings, audio, speech and transcription, images, video, moderation, realtime, and the legacy completion models `babbage-002` and `davinci-002`                       |
| `google`                                                              | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` and its next pages, with the key in `x-goog-api-key`, keeping the models whose `supportedGenerationMethods` include `generateContent`; `displayName`, `inputTokenLimit` and `outputTokenLimit` give the details            |
| a gateway                                                             | `GET <base_url>/models` with its key, headers and query parameters; an entry with a `type` other than `language`, as Vercel's gateway marks embedding and image models, is left out. When the list cannot be read, the models declared for the gateway are listed instead, and the answer is `partial` |
| `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` | The models declared for it, or `<provider>/*` when none is. Their own list APIs show a catalogue rather than what the credential may call, and need permissions of their own                                                                                                                           |

Every alias is listed by its own name.

### Declared models

`declared_models` in the [configuration file](../../README.md#configuring-a-model), or `DECLARED_MODELS`, which wins over it, names the models of a provider that does not list its own, and of a gateway whose list cannot be read, by provider prefix:

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
  azure:
    - gpt-5-production
  gateway:
    - llama-3.3-70b
```

`DECLARED_MODELS='{"bedrock":["eu.anthropic.claude-sonnet-4-5-20250929-v1:0"],"azure":["gpt-5-production"]}'` says the same. Each model id is written as the provider receives it, 1 to 256 characters without spaces or a `*`, once per provider. The keys are `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` and the names of the gateways; `anthropic`, `openai` and `google` list their own. A Bedrock ARN is refused, because it names an account and a region: give it an alias, which is listed by its own name. Any of these stops the start with `model_settings_invalid`.

### Allowed models

`allowed_models` in the configuration file, or `ALLOWED_MODELS` as a JSON list, which wins over it, names the only model references a spec may give. It is applied in one place for both of its uses: `list_models` shows only what it allows, and a spec that names anything else fails as `model_not_allowed` before any provider is called, which the spec operations answer as `unavailable` of the kind `model_not_offered` with `because: "model_not_allowed"`, naming the models that are offered. A provider that is not configured, while others are, is answered with the same kind and `because: "provider_not_configured"`; the plain words say which.

```yaml
allowed_models:
  - anthropic/*
  - gateway/llama-3.3-70b
  - house/fast
```

An entry is `provider/model`, or ends in a `*` that stands for any model id, as in an alias. It applies to the reference as the spec writes it, so allowing an alias's name allows what the alias is sent to. A wildcard alias, or `<provider>/*`, is listed only when a wildcard allows every model it stands for. Without the setting every model is allowed; an empty list, an entry that is not a reference, and a Bedrock ARN stop the start.

### How long a list is kept

Each list is read when `list_models` first needs it and kept in memory for five minutes, the interval the AI SDK's gateway provider keeps its own for. Calls that arrive while it is read wait for the same read. When a list cannot be read again, its last list is served and the answer is `partial`; the next call asks again. Lists are kept per provider, and a catalog belongs to one model access whose settings never change, so a list read with one credential is never served for another. Nothing is read when a spec runs, and the settings are read when the server starts, so a changed setting takes effect at the next start.

### What is never shown

The answer and its plain words carry no key, token, base URL, header, query parameter, account, project, region or Bedrock ARN, no price, description or other field a provider adds, and no owner a provider reports. When a list cannot be read, the caller sees only `partial`. The operator gets why: an answer with an error status goes to `reportProviderMessage`, with `model: null` and the message bounded and with the secrets of the settings redacted, as for a call; a provider that cannot be reached, does not answer within 10 seconds, has a certificate this server does not trust, or answers with something that is not a list of models goes to `reportOperatorHint`, such as `The list of models of gateway could not be read: it could not be reached`.

## When a provider is not configured

Nothing fails at start. A spec that names the provider fails with `provider_not_configured`, whose `detail`, the text its caller sees, names the providers that are configured:

```json
{
  "_tag": "provider_not_configured",
  "detail": "openai is not configured. Configured providers: anthropic, bedrock, bedrock-anthropic",
  "provider": "openai",
  "configured": ["anthropic", "bedrock", "bedrock-anthropic"],
  "missing": ["OPENAI_API_KEY"]
}
```

A prefix nobody configures, such as `mistral`, says `There is no provider named mistral` and the same; with no provider configured, the detail says `No model provider is configured`. When any alias is set, the detail names the aliases after the providers, so the caller sees every reference that works: `openai is not configured. Configured providers: gateway. Aliases: anthropic/*`. `missing` stays on the failure for the code that handles it and never reaches the caller.

An agent learns this before it writes a spec: the description of inference, which every spec tool carries, names the providers this server calls models through and how a model is written with them (`This server calls models through gateway: write model as <provider>/<model id>, with a model id that provider serves, for example gateway/<model id>.`), the alias names when any is set, with the references a wildcard alias accepts, or that no provider is configured. It does not name the models of a provider; it says that `list_models` lists the models this server can call. `makeModelAccess` also returns a `status`: the configured prefixes and, for each unconfigured built-in provider, the names of the settings it lacks, marked `partial` when some of its settings are present. When it starts, the server logs one line naming the configured providers, with every provider in its annotations, or a warning when none is configured. It adds a warning of its own only for a provider that is partly configured, the case that is usually a mistake:

```json
{"message":"Model providers configured: anthropic","level":"INFO","annotations":{"providers":[{"provider":"anthropic","configured":true},{"provider":"openai","configured":false,"missing":["OPENAI_API_KEY"]},…]}}
{"message":"Model provider azure is not configured; it needs AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID","level":"WARN","annotations":{"provider":"azure","configured":false,"missing":["AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID"]}}
```

## Failures

Every failure has a `_tag`, a `detail` safe to show the caller, and the `provider` prefix (or `null` when none was resolved). None carries anything from the prompt or the answer, except where the table says so.

| Failure                   | When                                                                                                                                                                                                                                                                                                                                                                                                                                | Also carries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | What the caller can do                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `spec_invalid`            | The model is not written `provider/model`; the request is invalid (no messages, `max_output_tokens` not an integer of 1 or more, `temperature` or `top_p` not finite, `seed` not an integer of 0 or more, `timeout_ms` not an integer of 1 or more); the output schema cannot be read; the provider answered HTTP 400, 404, 413, 422 or another 4xx not listed below; the SDK refused a setting, the prompt, a feature or the model | `status`, `issues` with JSON pointers into the request, and `provider_message`: the first line of the provider's own error message, at most 300 characters, only for a built-in provider at its default endpoint or a gateway with `expose_provider_messages`, and left out when it is empty, holds the raw response body, or is itself a JSON, HTML or XML document; see [Provider messages](#provider-messages). The `detail` names the provider, the HTTP status and what it means: the model was not found (404), the request was rejected as invalid (400 and 422), the request was too large (413), or the request was not accepted | Fix the spec                                      |
| `model_not_allowed`       | `allowed_models` is set and the model as the spec names it is not among them                                                                                                                                                                                                                                                                                                                                                        | `offered`, the entries of `allowed_models`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Name an offered model                             |
| `provider_not_configured` | The prefix is unknown; the provider's settings are missing (including Azure without a key and without `@azure/identity`); the provider's TLS certificate is not trusted                                                                                                                                                                                                                                                             | `configured` prefixes, `missing` setting names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fix the settings                                  |
| `credentials_rejected`    | HTTP 401 or 403; no credential could be obtained from the AWS chain, Google application default credentials or Microsoft Entra ID                                                                                                                                                                                                                                                                                                   | `status` (`null` when the credential source failed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fix the credentials or the role                   |
| `rate_limited`            | HTTP 429                                                                                                                                                                                                                                                                                                                                                                                                                            | `retry_after_ms` from `retry-after-ms`, or `retry-after` in seconds or as a date; `null` without a hint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Retry after the delay                             |
| `provider_unavailable`    | HTTP 408, 409 or 5xx (including 529); the connection failed; a 2xx response could not be read                                                                                                                                                                                                                                                                                                                                       | `status` (`null` when there was no response)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Retry later                                       |
| `content_refused`         | The provider refused the request under its content policy (HTTP 400 with the error code `content_filter` or `content_policy_violation`), or stopped the answer for it                                                                                                                                                                                                                                                               | `status`, `raw_finish_reason`, `usage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Change the input                                  |
| `output_invalid`          | JSON was asked for and the answer is not JSON, does not match the schema, or was cut off at `max_output_tokens`                                                                                                                                                                                                                                                                                                                     | `finish_reason`, `raw_finish_reason`, `usage`, and `issues` with JSON pointers into the answer and Effect's messages, which never quote the answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Retry, raise the token limit, or relax the schema |
| `timed_out`               | `timeout_ms` passed before the provider answered                                                                                                                                                                                                                                                                                                                                                                                    | `timeout_ms`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Retry, or allow more time                         |
| `cancelled`               | The caller's `signal` aborted                                                                                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing                                           |

A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"`. A failure this package does not recognise is a defect: the call dies with `UnclassifiedModelError`, which names the provider and the kind of error and nothing else.

### Retries

With `retries: 'adapter'`, the default, a call that fails with HTTP 408, 409, 429 or 5xx, or cannot connect, is tried up to twice more, after 2 and then 4 seconds, or after the provider's `retry-after` when it asks for less than a minute. A caller that retries on its own, such as a workflow engine, passes `retries: 'caller'`, and exactly one request is made. `timeout_ms` covers all attempts. An untrusted certificate is never retried.

## What is recorded, and what is never logged

A result carries `text`; `json` when JSON was asked for; `finish_reason` (`stop`, `length`, `content_filter`, `tool_calls`, `error` or `other`) and the provider's `raw_finish_reason`; `usage` (input tokens, of which uncached, cache read and cache write; output tokens, of which text and reasoning; and the total, each `null` when the provider did not say); the `model` as requested, as resolved and as answered; the provider's `response_id` (Bedrock's request id); `warnings` from the provider, such as a setting a model ignores; and `duration_ms`. The execution that runs a spec records the result.

This package logs nothing itself. It never returns, and no failure or defect carries:

- the request or response bodies the SDK keeps on its errors (`requestBodyValues`, `responseBody`, `data`), the errors of earlier attempts (`RetryError.errors`), or the texts and values on parse and validation errors, which hold the prompt or the answer;
- an API key, token or secret header: settings keep secrets redacted, and a settings error names the setting, never its value;
- the SDK's own error objects.

The SDK's warnings are not written to the console; they arrive in `warnings`.

### Provider messages

A provider's error message is free text, and through a gateway, or through a base URL the operator chose, it is the operator's text: it can name upstream providers, fallback chains or internal hosts. So the message reaches the caller only when the call went to a built-in provider at its default endpoint: `anthropic` without `ANTHROPIC_BASE_URL`, `openai` without `OPENAI_BASE_URL`, `google`, `bedrock` and `bedrock-anthropic` without an endpoint override, `azure` addressed by `AZURE_RESOURCE_NAME`, and `vertex` and `vertex-anthropic`. Even then the caller gets its first line, at most 300 characters, never a document.

For a gateway, and for a built-in provider at an overridden endpoint, the caller gets only what is structured: the provider prefix, the HTTP status, and what the status means. A gateway whose messages are safe to show opts in with `expose_provider_messages: true` in its entry.

The operator always gets the message: `makeModelAccess` takes an optional `reportProviderMessage`, which receives, for every call the provider answered with an error, the `provider`, the `model` as the spec names it (`null` for a list of models), the HTTP `status` (`null` when there was no response), the `message` (at most 2000 characters, never the request body) and the `execution_id` when the request carries one. The server logs it as a warning:

```json
{
  "message": "Model provider gateway answered with an error",
  "level": "WARN",
  "annotations": {
    "provider": "gateway",
    "model": "gateway/no-such-model-xyz",
    "status": 404,
    "execution_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
    "provider_message": "The model no-such-model-xyz does not exist on any upstream"
  }
}
```

In case a provider echoes them, what the caller and the operator get has every secret of the model settings (API keys, tokens, and the keys, headers and query parameters of gateways) replaced with `[redacted]`, and the instructions and each message of the prompt replaced with `[prompt]`, each when it is at least 8 characters long. A quote of only part of the prompt stays in the message.

Only `spec_invalid` can carry provider text. The other failures are built from the provider prefix, the HTTP status, a `retry-after` header and the answer's finish reason and usage.

### Operator hints

A failure that only the operator can fix tells the caller what happened and that the operator must act, and never names a setting. What to set goes to the operator: `makeModelAccess` takes an optional `reportOperatorHint`, which receives the `provider`, the `model` as the spec names it, the `hint` and the `execution_id`, for a provider certificate this server does not trust and for a setting the AI SDK found missing when it called the provider, in the SDK's words. The server logs it as a warning:

```json
{
  "message": "Model provider gateway could not be called: The TLS certificate of gateway is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS",
  "level": "WARN",
  "annotations": {
    "provider": "gateway",
    "model": "gateway/llama-3.3-70b",
    "execution_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"
  }
}
```

## Answers that are JSON

An answer schema is a JSON Schema document, draft 2020-12, or draft-07 when `$schema` says so or the document uses `definitions` without `$defs`. `compileAnswerSchema(document)` checks it and gives an `AnswerSchema`, or issues with JSON pointers into the document. The answer is validated here, against the schema as written, whatever the provider enforced. The validator is Effect's JSON Schema importer: it compiles a schema into data, not code, and it rejects regular expressions.

Limits on schemas, which the spec author controls:

- at most 65,536 bytes as JSON, at most 64 nested levels of objects and lists, at most 1000 values in one `enum`;
- no `pattern` or `patternProperties`, because a hostile regular expression can stall validation;
- no `if`, `then`, `else`, `contains`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedItems`, `unevaluatedProperties`, `additionalItems` or dynamic anchors; `$ref` only to `#/$defs/<name>` or `#/definitions/<name>`; `not` only as `{}`; `enum` and `const` only of strings, numbers, booleans and null; a schema for `additionalProperties` not together with `properties`;
- no definition that leads into a loop of `$ref`, `allOf`, `anyOf` or `oneOf` with no property or item in between, such as `"a": {"$ref": "#/$defs/a"}`: validating against it would never end. A definition may refer to itself through `properties` or `items`, as a tree does, and chains of definitions are allowed.

Limits on answers: at most 128 nested levels. A schema, an input or an answer that does not match reports each distinct issue once and at most 20 of them, followed by one that says how many more there were, such as `130 more issues are not shown`.

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

A request has `model`, optional `instructions`, `messages` (roles `user` and `assistant`, each with text parts), `output`, `settings` (`max_output_tokens`, and optionally `temperature`, `top_p`, `seed`, `stop_sequences` and `reasoning`), optional `provider_options`, `timeout_ms`, `signal` and `retries`. Some providers drop sampling settings for newer models and say so in `warnings`. `provider_options` passes options to the provider, keyed by the AI SDK's namespace for it: `anthropic`, `openai`, `azure`, `google`, `vertex`, `googleVertex`, `amazonBedrock`, `bedrock`, or the gateway's name. A call fails as `spec_invalid` before any provider is called when it holds a namespace no configured provider reads, or an option for a gateway its `allowed_provider_options` does not list; which options of the built-in providers a spec may set is checked when the spec is parsed (see [Provider options](#provider-options)). `requestIssues(request)` gives the problems of a request before it is sent.

`makeModelAccess(settings, options)` builds the same model and also returns `status`, and the `catalog` that [`list_models`](#listing-the-models) reads, whose `list(provider?)` gives the list. Its options inject a `fetch` and credential sources (`aws`, `google`, `azure`), which is how tests run without a network and how per-tenant credentials will be added, `reportProviderMessage`, which receives the [provider messages](#provider-messages) a caller does not see, and `reportOperatorHint`, which receives the [operator hints](#operator-hints). A request may carry an `execution_id`, which only those reports use; the inference primitive sets it to the execution's id.

## Testing

`makeInference({ languageModel, clock })` makes the primitive for `makeSpecOperations`; the server gives it the model of `makeModelAccess`, and a test the scripted model below. `clock` is optional: without it, `today` and `now` come from Effect's `Clock`.

`@beonauto/inference/testing` exports a fake for the tests of other packages. `scriptedLanguageModel(...replies)` answers with its replies in order, rejects an invalid request as the real one does, records every request (`requests()`), and provides itself as a `layer`. A reply is a function of the request; `answers(textResult('Hello'))` and `answers(jsonResult({ verdict: 'approve' }))` build the usual ones, and `() => Effect.fail(new RateLimited({ ... }))` scripts a failure.

No test in this package calls a model: the adapter is tested with the AI SDK's mock model and with the real provider packages against a fake `fetch` that answers with each provider's documented response shape.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/model` holds the interface: the request, the result, the `LanguageModel` service and the request checks. `src/failure` holds one class per failure. `src/schema` holds answer schemas: limits, the shape check, compilation, validation and portability. `src/settings` reads the settings from the environment with Effect `Config`. `src/adapter` is the only production code that imports the AI SDK and the cloud credential libraries. `src/listing` reads the list of models of each provider, and `src/catalog` keeps the lists, combines them with the declared models and the aliases, applies the allow list, and defines `list_models`. `src/template` is the only code that imports liquidjs: the configured engine, the filters, the system block, compiling and rendering, behind readonly types of its own. `src/spec` parses and validates a spec document: the split, the YAML, the front matter, the settings, the schemas and the variables a template reads. `src/primitive` is the primitive: its description, preparing the input, rendering the prompt, the request, the rejections and the record. `src/testing` holds the fake and what the tests share, including the SDK's mock model.

## The spec document format

An inference spec is one Markdown document (`text/markdown`): YAML front matter between two lines of three dashes, then a Liquid template. The front matter uses Dotprompt's key names; the format is this package's own, and this package parses it.

```markdown
---
description: Summarizes an account for the sales team
model: anthropic/claude-sonnet-4-5
config:
  max_output_tokens: 800
  temperature: 0.2
input:
  schema:
    type: object
    properties:
      account: { type: string }
      tone: { type: string }
    required: [account]
  default:
    tone: plain
---

{% system %}You write for a sales team, in a {{ input.tone }} tone.{% endsystem %}
Summarize the account {{ input.account }} as of {{ today }}.
```

| Key                        | Required    | Value                                                 | Meaning                                                                                                                                                                                  |
| -------------------------- | ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`              | No          | Text of 1 to 1000 characters                          | What the spec does. `list_specs` and `get_spec` show it                                                                                                                                  |
| `model`                    | Yes         | `provider/model`                                      | The model to call; see [How a model reference is resolved](#how-a-model-reference-is-resolved)                                                                                           |
| `config.max_output_tokens` | No          | A whole number from 1 to 64000; 1024 when left out    | The most tokens the answer may take. The time the call may take grows with it                                                                                                            |
| `config.temperature`       | No          | A number                                              | Sampling temperature. Providers accept different ranges and reject a value outside theirs                                                                                                |
| `config.top_p`             | No          | A number                                              | Nucleus sampling                                                                                                                                                                         |
| `config.seed`              | No          | A whole number of 0 or more                           | A seed, for providers that take one                                                                                                                                                      |
| `config.stop_sequences`    | No          | A list of texts                                       | Texts that end the answer                                                                                                                                                                |
| `config.reasoning`         | No          | `none`, `minimal`, `low`, `medium`, `high` or `xhigh` | Reasoning effort, for models that reason                                                                                                                                                 |
| `input.schema`             | No          | A JSON Schema whose root is `"type": "object"`        | The input of an execution must match it. Without it, any JSON object is accepted                                                                                                         |
| `input.default`            | No          | A JSON object                                         | Values merged under the input before it is validated. They must match the schema for the fields they name; required fields may be left to the input                                      |
| `output.format`            | No          | `text`, the default, or `json`                        | Whether the answer is the model's text or a JSON value                                                                                                                                   |
| `output.schema`            | With `json` | A JSON Schema                                         | The answer must match it; see [Answers that are JSON](#answers-that-are-json). Not allowed with `text`                                                                                   |
| `provider_options`         | No          | An object of objects, keyed by the provider namespace | Options for `anthropic`, `openai`, `azure`, `google`, `vertex`, `googleVertex`, `amazonBedrock`, `bedrock`, or a gateway's name: only those [Provider options](#provider-options) offers |

Any other key, at any level, is rejected.

Parsing is validation. Every create, update and execution parses the document, and a document with a problem is rejected with every problem found at once, each with its line in the document, and a JSON pointer into the front matter where there is one, for example `Line 4, /config/temperature: Expected number`. The operations answer them under `/source`. An issue found more than once is reported once, and a rejection reports at most 20, in the order of their lines, followed by one that says how many more there were, such as `Line 23: 5881 more issues are not shown`. Parsing finds:

- front matter that does not open on the first line or is never closed; a document without it is never read as a template;
- YAML that cannot be read. The front matter is YAML 1.2 with the core schema, so `yes` and `2026-10-01` stay text. Anchors, aliases and tags are rejected, a key may appear once in a mapping, numbers are finite, and nesting stops at 72 levels: deeper front matter, however deep, is rejected with `The front matter may nest at most 72 levels`;
- unknown keys and values of the wrong type, and a missing `model`;
- a model not written `provider/model`, and settings out of range;
- an input schema whose root is not an object, a schema that cannot be validated (see [Answers that are JSON](#answers-that-are-json) for what is rejected), and defaults that do not match it;
- a `json` output without a schema, and a `text` output with one;
- a provider option that is not offered, and a namespace that is no provider's (see [Provider options](#provider-options));
- Liquid that does not parse, a tag or filter that is not available, the rules of the system block, a template that writes no message outside it, and every variable it reads (see below).

A JSON output schema that some providers reject or do not enforce is accepted. The spec then carries `warnings`, which `create_spec`, `get_spec`, `list_specs` and `update_spec` show, each with its line and the providers concerned, for example `Line 8, /output/schema/properties/total/minimum: minimum is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)`. At most 100 are shown.

### Provider options

`provider_options` passes options to the AI SDK for a provider, keyed by the namespace the SDK reads for it. A spec may set only the options that shape how the model reasons or writes its answer. None of these is offered, whatever the provider: attribution (`user`, `metadata`, `labels`, request metadata), anything stored or reused on the operator's account (`store`, `previousResponseId`, `conversation`, `container`, `cachedContent`, prompt cache keys and retention), routing, fallbacks, capacity and service tiers, request headers and betas, tools and servers, guardrails, raw request fields, options for the state of a conversation (a spec makes one call), output the runtime does not read, and anything the front matter already sets (`config` and `output`, such as an effort level or the strictness of a JSON schema). An option is offered only when it is listed here; an option a provider adds is not offered until it is reviewed and listed.

| Namespace       | Read by                                                                      | Offered                                                                        |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `anthropic`     | `anthropic`, `bedrock-anthropic`, `vertex-anthropic`                         | `thinking`, with only `type`, `budgetTokens` and `display`                     |
| `openai`        | `openai`, and `azure` when there are no `azure` options                      | `textVerbosity`, `reasoningMode`, `logitBias`                                  |
| `azure`         | `azure`                                                                      | `textVerbosity`, `reasoningMode`, `logitBias`                                  |
| `google`        | `google`, and `vertex` when there are no `googleVertex` or `vertex` options  | `thinkingConfig`, `safetySettings`, `threshold`                                |
| `vertex`        | `vertex`                                                                     | `thinkingConfig`, `safetySettings`, `threshold`                                |
| `googleVertex`  | `vertex`, `vertex-anthropic`                                                 | `thinkingConfig`, `safetySettings`, `threshold`, `thinking` as for `anthropic` |
| `amazonBedrock` | `bedrock`                                                                    | `reasoningConfig`                                                              |
| `bedrock`       | `bedrock` when there are no `amazonBedrock` options, and `bedrock-anthropic` | `reasoningConfig`                                                              |

Some of what is withheld, and why:

- `anthropic`: `effort`, which `config.reasoning` sets; `cacheControl` and `container` (stored on the account); `metadata` (attribution); `mcpServers`, `disableParallelToolUse`, `toolStreaming` and `safeguards` (tools and servers); `anthropicBeta` (a request header); `fallbacks`, `speed`, `serviceTier` and `inferenceGeo` (routing and capacity); `sendReasoning`, `taskBudget`, `compaction` and `contextManagement` (conversation state); `structuredOutputMode` (the front matter's `output` decides how JSON is asked for); `thinking.blockBinding`, which turns on a beta.
- `openai`, `azure`: `reasoningEffort`, `reasoningEffortUpdate` and `maxCompletionTokens` (`config` sets them); `store`, `previousResponseId`, `conversation` and the prompt cache options; `user`, `safetyIdentifier` and `metadata`; `serviceTier`; `prediction` (raw request content); `instructions`, `systemMessageMode`, `forceReasoning` and `strictJsonSchema`, which change how the runtime sends the prompt or the schema; `logprobs`, `include` and `reasoningSummary` (output the runtime does not read); the tool options.
- `google`, `vertex`, `googleVertex`: `labels`; `cachedContent`; `serviceTier`, `sharedRequestType` and `requestType` (Vertex AI capacity headers); `retrievalConfig` and `streamFunctionCallArguments`; `responseModalities`, `imageConfig`, `audioTimestamp` and `mediaResolution`; `structuredOutputs`.
- `amazonBedrock`, `bedrock`: `additionalModelRequestFields`, and every key Bedrock does not read, because Bedrock adds those to the Converse request as they are (`inferenceConfig`, `guardrailConfig`, `requestMetadata` and the like); `anthropicBeta`; `serviceTier`; `structuredOutputMode`. The options of Anthropic models on Bedrock go under `anthropic`, since Bedrock would send them as they are under `bedrock`.

Any other option is rejected when the document is parsed, with the option named and the words `is not offered`, so such a spec is never stored. A namespace that is neither a provider's nor shaped like a gateway's name is rejected the same way. The offered and withheld options are one table of data in `src/model/offered-provider-options.ts`, typed against the option types the AI SDK exports, so an upgrade that adds or removes an option fails the type check until the option is decided.

A gateway is a different case: the AI SDK adds every key under the gateway's name, or its camel case (`my-gateway` and `myGateway`), to the request body as it is, and reads `user` from `openaiCompatible`. A gateway gives meaning to body fields its operator may not want a tenant to set: attribution and budgets, routing and fallbacks, mock answers, endpoints and credentials. So a spec sets for a gateway only the top-level fields its entry lists in `allowed_provider_options`, under any of those namespaces, and by default none. The list is checked when the server starts: at most 64 distinct names of 1 to 64 characters, none of them a field the runtime sets or that changes what the call is (`model`, `messages`, `stream`, `stream_options`, `n`, `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `response_format`, `tools`, `tool_choice`, `functions`, `function_call`, `reasoning_effort`, `verbosity`, and the SDK's `reasoningEffort`, `textVerbosity` and `strictJsonSchema`). A problem names the setting and the field, never a value.

The parser does not know the gateways, so this check runs when the spec executes: a field outside the list rejects the execution as `conflict`, naming the field and saying the gateway does not allow it, and the gateway is not called. The same goes for a namespace that is shaped like a gateway's name but is no configured gateway's: the execution is rejected as `conflict` before any provider is called.

A document is checked without calling a model, and the same document always gives the same answer. Whether its provider is configured, and whether the provider accepts the model and the settings, shows only when it runs; see [When an execution is rejected](#when-an-execution-is-rejected).

## The template language

The template is [Liquid](https://shopify.github.io/liquid/), rendered by liquidjs 10.29.0, configured for templates written by tenants: templates live in memory and the engine has no file system.

### Variables

A template reads three variables and nothing else:

- `input`: the input of the execution, with the defaults merged under it and validated;
- `today`: the date, `YYYY-MM-DD`, in UTC;
- `now`: the time, in ISO 8601, in UTC.

`today` and `now` come from the server's clock when the execution starts, and have no properties. Names a template makes itself, with `assign`, `for`, `increment` or `cycle`, are fine. Any other name is rejected when the document is parsed, by the engine's static analysis of the template. When the input schema declares `properties` and sets `"additionalProperties": false`, `input.<field>` must be one of them.

Reading is strict. A field the input does not have stops the execution with `invalid_input`, naming the field, except in a condition of `if`, `elsif` or `unless` and in the `default` filter, so a template can test a field that may be absent: `{% if input.vip %}…{% endif %}`, `{{ input.nickname | default: "friend" }}`. Only the input's own fields can be read: `input.constructor` is a missing field. Values are written as Liquid writes them: a list as its items without separators, an object as `[object Object]`; write `{{ input.account | json }}` for JSON.

### The system block

```liquid
{% system %}You review expenses against the policy of {{ input.company }}.{% endsystem %}
Review this expense: {{ input.expense | json }}
```

- What is between `{% system %}` and `{% endsystem %}` is sent as the system instructions; everything outside it is the message, sent as one user message.
- A template has at most one system block, at its top level, outside every other tag, and the tags take no arguments. The template must write something outside it.
- The block is found in the template's own syntax tree, never in the rendered text. An input that holds `{% system %}` or `{% endsystem %}` is written as those characters, in the part where the template writes it, and can never open or close the instructions.
- The template renders in document order, so a value assigned in the block is known after it.

### Tags

Available: `assign`, `if` with `elsif` and `else`, `unless`, `case` with `when`, `for` with `break` and `continue`, `cycle`, `increment`, `decrement`, `echo`, `liquid`, `raw`, `comment`, `#` and `tablerow`.

Not available: `include`, `render`, `layout` and `block` load other templates, and a spec is one document; `capture` renders into a buffer of its own, outside the limit on the rendered size, so use `assign` with `append` instead.

### Filters

The plain data and string filters of Liquid: `abs`, `append`, `array_to_sentence_string`, `at_least`, `at_most`, `base64_decode`, `base64_encode`, `capitalize`, `ceil`, `compact`, `concat`, `default`, `divided_by`, `downcase`, `escape`, `escape_once`, `find`, `find_index`, `first`, `floor`, `group_by`, `has`, `join`, `json`, `last`, `lstrip`, `map`, `minus`, `modulo`, `newline_to_br`, `normalize_whitespace`, `number_of_words`, `plus`, `pop`, `prepend`, `push`, `raw`, `reject`, `remove`, `remove_first`, `remove_last`, `replace`, `replace_first`, `replace_last`, `reverse`, `round`, `rstrip`, `shift`, `size`, `slice`, `slugify`, `sort`, `sort_natural`, `split`, `squish`, `strip`, `strip_newlines`, `sum`, `times`, `to_integer`, `truncate`, `truncatewords`, `uniq`, `unshift`, `upcase`, `where` and `xml_escape`.

Three more:

| Filter  | What it does                                                                                                                                                           | Example                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `money` | A number, or text that is a decimal number, as US dollars with thousands separators: no cents when it is whole, two decimals otherwise. Anything else stops the render | `{{ 364028 \| money }}` is `$364,028`; `1234.5` is `$1,234.50` |
| `clip`  | Text cut to a number of characters, 400 by default, with an ellipsis (`…`) appended when it is cut. Characters are counted as Unicode code points                      | `{{ input.notes \| clip: 200 }}`                               |
| `words` | The number of words in a text: runs of characters between whitespace                                                                                                   | `{% assign n = input.notes \| words %}`                        |

Left out, and why:

- `where_exp`, `reject_exp`, `group_by_exp`, `has_exp`, `find_exp` and `find_index_exp` evaluate an expression given as text, which the check of the variables a template reads cannot see;
- `date`, `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and `date_to_long_string` read the server's clock, time zone and locale, so the same spec would render differently from one server to the next; `today` and `now` give the date and the time;
- `sample` is random;
- `sha256` and `hmac_sha256` compute digests, which a prompt has no use for, and `hmac_sha256` would put a key in a spec;
- `strip_html` is a hand-written HTML parser that had three advisories in 2026 (a regular expression that backtracks, an infinite loop, and a bypass); they are fixed in this version, and a prompt has no HTML to strip;
- `url_encode`, `cgi_escape`, `uri_escape` and `url_decode`: the encoders grow their output without charging the memory limit (nine `url_encode` in a row turn 65,536 characters into 1,245,184 without charging anything), and a prompt has no URL to encode;
- `inspect` and `jsonify` do what `json` does.

As of October 2026, no published advisory affects liquidjs 10.27.2 or later; earlier versions have several, including code execution from a crafted template. 10.29.0 is the newest release the workspace's minimum release age allows.

### Limits

| Limit                                       | Value                         | Why                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Length of the template                      | 65,536 characters             | The document itself takes at most 65,536 bytes                                                                                                                                         |
| Names in tags and outputs                   | 1000                          | The engine's static analysis finds the position of every variable from the start of the text: 1000 variables at the end of a 64 KiB template take 90 ms to analyse, 13,107 take 574 ms |
| Time to render                              | 200 ms                        | Rendering is synchronous. The heaviest renders measured take 3 to 10 ms: a loop over 2000 items writing 114,000 characters takes 9 ms                                                  |
| Memory that filters and ranges may charge   | 5,000,000 characters or items | About nineteen passes of a filter over the largest input an execution takes (256 KiB)                                                                                                  |
| Rendered instructions, and rendered message | 200,000 characters each       | Checked as the output is written, so a render stops as soon as it grows past it                                                                                                        |

Names are counted in the text inside `{{ }}` and `{% %}`: every variable, property, filter and keyword. A template over the first two limits is rejected when it is parsed. The engine reads tags and parentheses recursively, so a template that nests them more deeply than it can read (about 2000 levels of tags) is rejected with `The tags or parentheses of the template nest too deeply to be read`, never with the engine's own message. A render that hits one of the last three stops the execution with `invalid_input`, because it is the input that makes the render grow.

## Creating and executing a spec

The spec operations of [`@beonauto/specs`](../../packages/specs) store and run inference specs: `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, `execute_spec` and `get_execution`, under `/v1/orgs/{org}/brains/{brain}`, with `inference` as the primitive. Give the server a key for the provider first; it reads the model settings when it starts:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

With the document of [The spec document format](#the-spec-document-format) saved as `account-summary.md`, create a brain and the spec. `jq` turns the document into a JSON string:

```bash
curl --request POST http://localhost:8080/v1/orgs/acme/brains \
  --header 'content-type: application/json' \
  --data '{"brain":"sales","name":"Sales"}'
jq --null-input --rawfile source account-summary.md '{name: "account-summary", source: $source}' |
  curl --request POST http://localhost:8080/v1/orgs/acme/brains/sales/specs/inference \
    --header 'content-type: application/json' --data @-
```

`create_spec` answers `201` with the spec: its `version` 1, the `description`, the `input_schema`, any `warnings`, and the document as `source`. A document with problems gets `422` with every problem under `/source`. Read it back, and list the specs of the brain:

```bash
curl http://localhost:8080/v1/orgs/acme/brains/sales/specs/inference/account-summary
curl http://localhost:8080/v1/orgs/acme/brains/sales/specs/inference
```

Execute it. The optional `execution_id` names the execution, so a call can be retried safely:

```bash
curl --request POST http://localhost:8080/v1/orgs/acme/brains/sales/specs/inference/account-summary/execute \
  --header 'content-type: application/json' \
  --data '{"input":{"account":"Globex"},"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
```

```json
{
  "execution_id": "0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a",
  "primitive": "inference",
  "name": "account-summary",
  "spec_version": 1,
  "status": "succeeded",
  "output": "Globex renewed for two years and expanded to three regions this quarter.",
  "started_at": "2026-10-01T09:30:00.000Z",
  "started_by": "local",
  "finished_at": "2026-10-01T09:30:02.412Z"
}
```

`get_execution` reads it back with the [record](#what-an-execution-records):

```bash
curl http://localhost:8080/v1/orgs/acme/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

An agent calls the same operations as MCP tools on `POST /mcp`, where the tools inside a brain take its id as `brain`: the tools that name a primitive carry this primitive's description of the document format, and a rejection comes back as `isError` with the same problem document. A retry with the same `execution_id`, the same spec and the same input answers the recorded execution and calls no model. `update_spec` (`PUT …/specs/inference/account-summary` with a new `source`) makes version 2, and `retire_spec` (`POST …/retire`) retires the spec for good. The [specs README](../../packages/specs/README.md) has the rules of each operation.

`scripts/try-inference.sh` at the root of the repository does all of this against a server that is already running, with a small spec of its own, and prints the execution and its record. It starts nothing, and needs `curl` and `jq`:

```bash
scripts/try-inference.sh http://localhost:8080 anthropic/claude-sonnet-4-5
```

It works in org `local`, or `AUTO_BRAIN_ORG`, creates a brain named `try-<seconds>`, and sends `AUTO_BRAIN_KEY` as the API key when it is set. CI never runs it.

## An example with a JSON answer

```markdown
---
description: Checks an expense against the travel policy
model: openai/gpt-5
config:
  max_output_tokens: 300
input:
  schema:
    type: object
    properties:
      expense: { type: string }
      amount: { type: number }
    required: [expense, amount]
    additionalProperties: false
output:
  format: json
  schema:
    type: object
    properties:
      approve: { type: boolean }
      reason: { type: string }
    required: [approve, reason]
    additionalProperties: false
---

{% system %}You check expenses against the travel policy: meals up to $80 a person, no alcohol.{% endsystem %}
Expense: {{ input.expense }}, {{ input.amount | money }}.
```

Executed with `{"input":{"expense":"Dinner for two with a client","amount":142.5}}`, it answers with the JSON value, validated against the schema:

```json
{
  "status": "succeeded",
  "output": { "approve": true, "reason": "Two meals at $71.25 each are within the $80 limit." }
}
```

## When an execution is rejected

The spec operations answer every rejection as a problem document, and record it on the execution. A call with the same `execution_id` runs the spec again after `unavailable` or `conflict`, and answers the same `invalid_input` again.

| What happened                                                                                        | Rejection                                                                                                                                                  | HTTP |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| The input is not a JSON object, or does not match the input schema                                   | `invalid_input`, with the issues under `/input`                                                                                                            | 422  |
| The template reads a field the input does not have, outside a condition                              | `invalid_input` at `/input/<field>`, naming the field and the line                                                                                         | 422  |
| A filter rejects a value of the input, a render limit stops the render, or the message renders empty | `invalid_input`, with the line                                                                                                                             | 422  |
| The model refuses the content under its policy                                                       | `invalid_input` at `/input`                                                                                                                                | 422  |
| The provider rejects the spec: a model it does not have, a schema or a setting it cannot accept      | `conflict`, naming the provider, the HTTP status and what it means; the provider's own words only where [Provider messages](#provider-messages) allow them | 409  |
| The spec sets a provider option its gateway does not allow                                           | `conflict`, naming the option; the gateway is not called                                                                                                   | 409  |
| A JSON answer is cut off at `max_output_tokens`                                                      | `conflict`, saying to raise `config.max_output_tokens`                                                                                                     | 409  |
| The answer leaves no room in the 1 MiB an execution records                                          | `conflict`, saying to lower `config.max_output_tokens`                                                                                                     | 409  |
| The spec names a model outside `allowed_models`                                                      | `unavailable` of the kind `model_not_offered` because `model_not_allowed`, naming the offered models; nothing is sent                                      | 503  |
| The provider is not configured, or its certificate is not trusted                                    | `unavailable`, naming the provider, the configured providers and the aliases, or saying that the operator must act; never a setting                        | 503  |
| The provider rejects the credentials                                                                 | `unavailable`, with the HTTP status                                                                                                                        | 503  |
| The provider limits the rate of requests                                                             | `unavailable`, saying how many seconds to wait when it said                                                                                                | 503  |
| The provider cannot be reached or cannot serve now, or does not answer in time                       | `unavailable`, saying to try again later                                                                                                                   | 503  |
| A JSON answer does not match the schema                                                              | `unavailable`, with the first issues, saying to try again                                                                                                  | 503  |
| The caller goes away before the answer                                                               | the execution is interrupted and stays `started`                                                                                                           | 499  |

A text answer cut off at `max_output_tokens` succeeds, with `finish_reason: "length"` in the record. A call may take 60 seconds plus 25 ms for every token of `max_output_tokens`: 85.6 seconds for the default 1024, and that covers the up to two retries of a failure that may pass (see [Retries](#retries)). The spec operations add their own rejections: `not_found` for a spec the brain does not have, and `conflict` for a retired spec or one whose document no longer parses.

## What an execution records

`get_execution` shows the record of a succeeded execution:

| Field                                | What it holds                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `model`                              | The model as `requested`, as `resolved` through the aliases, and as the provider `answered`                           |
| `settings`                           | The settings sent, with the default `max_output_tokens` filled in                                                     |
| `output_format`                      | `text` or `json`                                                                                                      |
| `finish_reason`, `raw_finish_reason` | Why the answer ended, and the provider's own word for it                                                              |
| `usage`                              | Input tokens (uncached, cache read, cache write), output tokens (text, reasoning) and the total; `null` where unknown |
| `response_id`                        | The provider's id of the response                                                                                     |
| `warnings`                           | What the provider said it ignored or changed, at most 20                                                              |
| `duration_ms`                        | How long the call took                                                                                                |
| `prompt`                             | The rendered `instructions` and `message`, and `truncated`                                                            |

The output and the record take at most 1 MiB together, the limit of the spec operations. When the prompt does not fit beside the answer, the record keeps the start of the instructions and of the message and sets `truncated: true`. The record holds no credential, and not the provider options, which the spec already holds.
