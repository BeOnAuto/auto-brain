# Configure the runtime

Settings come from environment variables and, for those that are lists or maps, from an optional YAML file:

- **Environment variables** can hold every setting, and are the only place for keys and other secrets. In development, `pnpm dev` reads `.env` at the root of the repository after `packages/server/dev.env`, and a variable set in the shell wins over both; the server itself never reads `.env`. A container takes environment variables, or a file of them with `docker run --env-file`.
- **The configuration file**, named by `CONFIG_FILE`, holds `model_gateways`, `model_aliases`, `declared_models`, `allowed_models`, `api_keys` and `allowed_origins`. `pnpm dev` passes `auto-brain.yaml` at the root of the repository when it is there; copy [`auto-brain.example.yaml`](https://github.com/BeOnAuto/auto-brain/blob/main/auto-brain.example.yaml) to start one. Git ignores it.

Each key of the file stands for the environment variable of the same name in upper case, and a variable that is set wins over the key, whole: `MODEL_GATEWAYS` replaces the file's `model_gateways`, it is not merged with it. The server logs at start which settings it read from the file, and which of them the environment set too. A secret is never written in the file: the file refers to the variable that holds it as `${NAME}`, or `${NAME:-default}`, and `$$` stands for a literal `$`. A value that looks like a credential and is not such a reference stops the server at start.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeOnAuto/auto-brain/main/auto-brain.schema.json
model_gateways:
  - name: gateway
    base_url: https://gateway.example.com/v1
    api_key: ${GATEWAY_API_KEY}
model_aliases:
  anthropic/*: gateway/anthropic/*
```

[`auto-brain.schema.json`](https://github.com/BeOnAuto/auto-brain/blob/main/auto-brain.schema.json) is the file's JSON Schema, so an editor with the YAML language server completes and checks it. A file the server cannot use, a key it does not hold, a value its setting refuses or a reference to a variable that is not set stops it at start with one line that names the file, the line, the column and the key, never a value.

| To use                                               | Set                                                                                     | Example                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A provider's own API                                 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`                 | [Direct API keys](models.md#direct-api-keys)                                            |
| An OpenAI-compatible gateway                         | `model_gateways` in the file, a list whose `name` becomes the prefix, `gateway/<model>` | [A gateway](models.md#an-internal-openai-compatible-gateway-with-a-custom-header)       |
| Amazon Bedrock                                       | `AWS_REGION`, with the AWS default credential chain                                     | [Bedrock](models.md#amazon-bedrock-with-an-iam-role)                                    |
| Azure OpenAI                                         | `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`                                               | [Azure](models.md#azure-openai-with-an-api-key)                                         |
| Google Vertex AI                                     | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                                    | [Vertex](models.md#google-vertex-ai-with-workload-identity)                             |
| Your own names for models                            | `model_aliases` in the file                                                             | [Model aliases](models.md#model-aliases)                                                |
| Another provider's models, through your gateway      | `model_aliases: {anthropic/*: gateway/anthropic/*}` in the file                         | [Model aliases](models.md#model-aliases)                                                |
| The models listed for Bedrock, Azure or Vertex       | `declared_models` in the file, a list of model ids for each provider prefix             | [Listing the models](models.md#listing-the-models)                                      |
| Only some models                                     | `allowed_models` in the file, such as `[anthropic/*, gateway/llama-3.3-70b]`            | [Listing the models](models.md#listing-the-models)                                      |
| An outbound proxy or a private certificate authority | `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`                         | [Proxy and CA](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) |

`list_models` (`GET /v1/orgs/{org}/models`, and the MCP tool of the same name) lists the models the server can call: it asks Anthropic, OpenAI, Google and each gateway for their models with the server's own credentials, keeps each list for five minutes, adds the models `declared_models` names and the aliases whose target's provider is configured, and leaves out what `allowed_models` does not allow. A spec that names a model outside `allowed_models`, by its own name or the alias it is sent through, cannot run, and its run says the model is not offered and that `list_models` shows those that are.

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
allowed_models:
  - anthropic/*
  - bedrock/*
```
