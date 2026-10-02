import type { ModelSettings } from '../settings/model-settings.ts';
import type { AzureSettings } from '../settings/provider-settings.ts';
import type { Availability } from '../settings/setting-values.ts';
import {
  azureModels,
  bedrockAnthropicModels,
  bedrockModels,
  vertexAnthropicModels,
  vertexModels,
  type AzureCredential,
} from './cloud-providers.ts';
import {
  awsCredentialChain,
  googleCredentialChain,
  guarded,
  type AccessTokenSource,
  type CredentialSources,
} from './credential-sources.ts';
import { anthropicModels, gatewayModels, googleModels, openAiModels } from './direct-providers.ts';
import { withCertificateFailures } from './outbound-fetch.ts';
import type { Fetch, ModelFactory } from './sdk-model.ts';

export interface FactorySources {
  readonly fetch: Fetch;
  readonly credentials: CredentialSources;
  readonly azureTokens: AccessTokenSource | undefined;
}

type Entry = readonly [string, ModelFactory];

function entriesFor<S>(availability: Availability<S>, make: (settings: S) => readonly Entry[]): readonly Entry[] {
  return availability.configured ? make(availability.settings) : [];
}

function azureCredentialOf(
  settings: AzureSettings,
  tokens: AccessTokenSource | undefined,
): AzureCredential | undefined {
  if (settings.api_key !== null) {
    return { api_key: settings.api_key };
  }
  return tokens === undefined ? undefined : { tokens: guarded(tokens) };
}

function cloudEntries(settings: ModelSettings, { fetch, credentials, azureTokens }: FactorySources): readonly Entry[] {
  return [
    ...entriesFor(settings.bedrock, (bedrock) => {
      const aws = guarded(credentials.aws ?? awsCredentialChain(settings.proxy));
      return [
        ['bedrock', bedrockModels(bedrock, aws, fetch)],
        ['bedrock-anthropic', bedrockAnthropicModels(bedrock, aws, fetch)],
      ];
    }),
    ...entriesFor(settings.azure, (azure) => {
      const credential = azureCredentialOf(azure, azureTokens);
      return credential === undefined ? [] : [['azure', azureModels(azure, credential, fetch)]];
    }),
    ...entriesFor(settings.vertex, (vertex) => {
      const google = guarded(credentials.google ?? googleCredentialChain(vertex.project));
      return [
        ['vertex', vertexModels(vertex, google, fetch)],
        ['vertex-anthropic', vertexAnthropicModels(vertex, google, fetch)],
      ];
    }),
  ];
}

export function modelFactories(settings: ModelSettings, sources: FactorySources): ReadonlyMap<string, ModelFactory> {
  const fetch = withCertificateFailures(sources.fetch);
  return new Map([
    ...entriesFor(settings.anthropic, (anthropic) => [['anthropic', anthropicModels(anthropic, fetch)]]),
    ...entriesFor(settings.openai, (openai) => [['openai', openAiModels(openai, fetch)]]),
    ...entriesFor(settings.google, (google) => [['google', googleModels(google, fetch)]]),
    ...cloudEntries(settings, { ...sources, fetch }),
    ...settings.gateways.map((gateway): Entry => [gateway.name, gatewayModels(gateway, fetch)]),
  ]);
}
