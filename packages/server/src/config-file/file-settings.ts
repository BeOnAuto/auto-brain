import { fileSetting, type FileSetting } from '@beonauto/config';
import { ApiKeysSchema } from '@beonauto/identity';
import {
  AllowedModelsSchema,
  DeclaredModelsSchema,
  ModelAliasesSchema,
  ModelGatewaysSchema,
} from '@beonauto/inference';
import { ChannelsSchema } from '@beonauto/interaction';
import { AllowedToolsSchema, McpServersSchema } from '@beonauto/mcp';
import { Schema } from 'effect';

import { Origin } from '../settings/origin.ts';

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

export const fileSettings: readonly FileSetting[] = [
  fileSetting(
    'ALLOWED_ORIGINS',
    Schema.Array(Origin).annotate({
      description:
        'The origins a page in a browser may call the API from, such as https://app.example.com. ALLOWED_ORIGINS wins over it',
    }),
    (origins) => origins.join(','),
  ),
  fileSetting(
    'API_KEYS',
    ApiKeysSchema.annotate({
      description: 'The API keys the server accepts, each as the key command prints it. API_KEYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_GATEWAYS',
    ModelGatewaysSchema.annotate({
      description: 'OpenAI-compatible gateways, each a provider prefix of its own. MODEL_GATEWAYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_ALIASES',
    ModelAliasesSchema.annotate({
      description:
        'Model references a reasoning function may give, each sent on as another reference; a trailing * on both sides covers every model of a provider. MODEL_ALIASES wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'DECLARED_MODELS',
    DeclaredModelsSchema.annotate({
      description:
        'The models list_models shows for bedrock, bedrock-anthropic, azure, vertex and vertex-anthropic, which do not list their own, and for a gateway whose list cannot be read, keyed by the provider prefix. DECLARED_MODELS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'ALLOWED_MODELS',
    AllowedModelsSchema.annotate({
      description:
        'The only model references a reasoning function may give, by name or through an alias, and list_models shows, each provider/model or provider/* for every model of a provider; every model when left out. ALLOWED_MODELS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MCP_SERVERS',
    McpServersSchema.annotate({
      description:
        'The MCP servers whose tools a reasoning function may name, each bound to an org and optionally its brains: url for a remote server, command for a process. Secrets are references such as ${GRAPH_API_KEY}. MCP_SERVERS wins over it',
    }),
    asJson,
    { references: 'kept' },
  ),
  fileSetting(
    'CHANNELS',
    ChannelsSchema.annotate({
      description:
        'The channels interaction functions send their requests through, keyed by the name a function writes in channel: webhook for a signed HTTP POST, mcp for one call of a tool of mcp_servers. Each is bound to an org and optionally its brains, and to a pattern of the parties it may reach. Secrets are references such as ${PARTNER_WEBHOOK_SECRET}. CHANNELS wins over it',
    }),
    asJson,
    { references: 'kept' },
  ),
  fileSetting(
    'ALLOWED_TOOLS',
    AllowedToolsSchema.annotate({
      description:
        'The only tools a reasoning function may name, each server/tool or server/* for every tool of a server; every tool when left out. ALLOWED_TOOLS wins over it',
    }),
    asJson,
  ),
];
