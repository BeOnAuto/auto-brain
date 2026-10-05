# Model providers and gateways

These are settings for the runtime's implemented reason functions, identified as `inference` in the API. Model availability depends on your provider account.

## How a model reference is resolved

A spec names its model as `provider/model`, for example `anthropic/claude-sonnet-4-5` or `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`.

1. If the aliases (`model_aliases` in the configuration file, or `MODEL_ALIASES`) map the reference to another one, the other one is used: an exact alias first, then the wildcard alias with the longest prefix, such as `anthropic/*` (see [Model aliases](#model-aliases)). An alias resolves in one hop.
2. The reference is split at its first `/`. The part before it is the provider, everything after it is the model id the provider receives, unchanged (Bedrock ARNs keep their own `/`). A reference without a `/`, or with nothing on either side of it, is `spec_invalid` and nothing is sent.
3. When `allowed_models` is set, the reference as the spec writes it, or the reference an alias sends it to, must be one of its entries, or start with the part before the `*` of one of them; otherwise it fails as `model_not_allowed` and nothing is sent (see [Listing the models](#listing-the-models)).
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

In the server's [configuration file](configuration.md):

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
| `allowed_provider_options` | No       | The top-level request body fields a spec may set for this gateway through `provider_options`, for example `["user", "metadata"]`. Default none; see [Provider options](../reference/reasoning-format.md#provider-options)                                       |

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

`model_aliases` in the server's [configuration file](configuration.md) maps one reference to another. It lets specs keep a name while the deployment decides where it runs:

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

Its plain words name the models by the name their provider gives, or by the last part of the id, twenty at most, adding the provider to a name two providers share and naming by the id a name one provider repeats, and say which providers take any model id and when the list may be incomplete: `This server can call 6 models through anthropic and gateway: Claude Haiku 4.5 (anthropic), Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5 (gateway), and fast.`

### Where each list comes from

Each list is read with the credentials and endpoint the server calls the provider with, through the same `fetch`, so `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` apply. A page is read within 10 seconds and 8 MiB, in one pass however small the pieces it arrives in, and a list of more than 10 pages is not read.

| Provider                                                              | List                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anthropic`                                                           | `GET <base URL>/models?limit=1000` and its next pages, with the key or token and `anthropic-version: 2023-06-01`; `display_name`, `created_at`, `max_input_tokens` and `max_tokens` give the details                                                                                                   |
| `openai`                                                              | `GET <base URL>/models` with the key, without the ids that by OpenAI's naming are not for a conversation: fine-tunes (`ft:`), embeddings, audio, speech and transcription, images, video, moderation, realtime, and the legacy completion models `babbage-002` and `davinci-002`                       |
| `google`                                                              | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` and its next pages, with the key in `x-goog-api-key`, keeping the models whose `supportedGenerationMethods` include `generateContent`; `displayName`, `inputTokenLimit` and `outputTokenLimit` give the details            |
| a gateway                                                             | `GET <base_url>/models` with its key, headers and query parameters; an entry with a `type` other than `language`, as Vercel's gateway marks embedding and image models, is left out. When the list cannot be read, the models declared for the gateway are listed instead, and the answer is `partial` |
| `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` | The models declared for it, or `<provider>/*` when none is. Their own list APIs show a catalogue rather than what the credential may call, and need permissions of their own                                                                                                                           |

Every alias is listed by its own name, unless the provider of its target is not configured: a spec cannot call it then, and the description of inference and the instructions of `/mcp` leave it out too. Each entry of a list is read on its own, so an entry with a field of an unexpected type, or null, does not cost the others: an entry without a text id is left out, and a detail that is not of its type is taken as not reported. An entry whose id is empty, longer than 256 characters, holds a space, a control character or a `*`, or is a Bedrock ARN is left out, the same rule declared models meet; a lookalike of another id, such as one with a Cyrillic letter, is kept, since it is what a spec would have to write. A name longer than 100 characters or on more than one line is left out, and the entry kept.

### Declared models

`declared_models` in the [configuration file](configuration.md), or `DECLARED_MODELS`, which wins over it, names the models of a provider that does not list its own, and of a gateway whose list cannot be read, by provider prefix:

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
  azure:
    - gpt-5-production
  gateway:
    - llama-3.3-70b
```

`DECLARED_MODELS='{"bedrock":["eu.anthropic.claude-sonnet-4-5-20250929-v1:0"],"azure":["gpt-5-production"]}'` says the same. Each model id is written as the provider receives it, 1 to 256 characters without spaces, control characters or a `*`, once per provider. The keys are `bedrock`, `bedrock-anthropic`, `azure`, `vertex`, `vertex-anthropic` and the names of the gateways; `anthropic`, `openai` and `google` list their own. A Bedrock ARN is refused, because it names an account and a region: give it an alias, which is listed by its own name. Any of these stops the start with `model_settings_invalid`.

### Allowed models

`allowed_models` in the configuration file, or `ALLOWED_MODELS` as a JSON list, which wins over it, names the only model references a spec may give. It is applied in one place for both of its uses: `list_models` shows only what it allows, and a spec that names anything else fails as `model_not_allowed` before any provider is called, which the spec operations answer as `unavailable` of the kind `model_not_offered` with `because: "model_not_allowed"`; its detail names the model, never the allow list, and its plain words point to `list_models`. A provider that is not configured, while others are, is answered with the same kind and `because: "provider_not_configured"`; the plain words say which.

```yaml
allowed_models:
  - anthropic/*
  - gateway/llama-3.3-70b
  - house/fast
```

An entry is `provider/model`, or ends in a `*` that stands for any model id, as in an alias. It applies to the reference a spec names and to the reference that reference resolves to: an alias is allowed when its own name or its target is, and a target named directly only when it is allowed itself. A wildcard alias, or `<provider>/*`, is listed only when a wildcard allows every model it stands for. The description of inference and the instructions of `/mcp` name only the providers and aliases a spec may use under it. Without the setting every model is allowed. An empty list stops the start, and so does an entry that is not a reference, has an uppercase provider, a space or a control character, is a Bedrock ARN, is listed twice, or can match no configured provider and no alias, such as `There is no provider named mistral, nor an alias that mistral/large matches`.

### How long a list is kept

Each list is read when `list_models` first needs it and kept in memory for five minutes, the interval the AI SDK's gateway provider keeps its own for. Calls that arrive while it is read wait for the same read. When a list cannot be read again, its last list is served and the answer is `partial`, and the provider is not asked again for a minute, so that callers cannot make the server press a provider that is failing or limiting its rate; the first call after that minute asks again. Lists are kept per provider, and a catalog belongs to one model access whose settings never change, so a list read with one credential is never served for another. Nothing is read when a spec runs, and the settings are read when the server starts, so a changed setting takes effect at the next start.

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
| `model_not_allowed`       | `allowed_models` is set and neither the model as the spec names it nor the model an alias sends it to is among them                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Name an offered model                             |
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
