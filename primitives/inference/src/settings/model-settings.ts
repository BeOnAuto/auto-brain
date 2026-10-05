import { Config, Data, Effect } from 'effect';

import { aliasReading } from './alias-settings.ts';
import { catalogReading } from './catalog-settings.ts';
import { gatewayReading, type GatewaySettings } from './gateway-settings.ts';
import {
  anthropicReading,
  anthropicSource,
  azureReading,
  azureSource,
  bedrockReading,
  bedrockSource,
  googleReading,
  googleSource,
  openAiReading,
  openAiSource,
  vertexReading,
  vertexSource,
  type AnthropicSettings,
  type AzureSettings,
  type BedrockSettings,
  type GoogleSettings,
  type OpenAiSettings,
  type VertexSettings,
} from './provider-settings.ts';
import {
  optionalText,
  settingsFrom,
  type Availability,
  type Environment,
  type Reading,
  type SettingProblem,
} from './setting-values.ts';

export interface ProxySettings {
  readonly enabled: boolean;
  readonly environment: Environment;
}

export interface ModelSettings {
  readonly anthropic: Availability<AnthropicSettings>;
  readonly openai: Availability<OpenAiSettings>;
  readonly google: Availability<GoogleSettings>;
  readonly bedrock: Availability<BedrockSettings>;
  readonly azure: Availability<AzureSettings>;
  readonly vertex: Availability<VertexSettings>;
  readonly gateways: readonly GatewaySettings[];
  readonly aliases: ReadonlyMap<string, string>;
  readonly declared: ReadonlyMap<string, readonly string[]>;
  readonly allowed: readonly string[] | null;
  readonly proxy: ProxySettings;
}

export class ModelSettingsInvalid extends Data.TaggedError('model_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const proxyVariables = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];

const sources = Config.all({
  anthropic: anthropicSource,
  openai: openAiSource,
  google: googleSource,
  bedrock: bedrockSource,
  azure: azureSource,
  vertex: vertexSource,
  gateways: optionalText('MODEL_GATEWAYS'),
  aliases: optionalText('MODEL_ALIASES'),
  declared: optionalText('DECLARED_MODELS'),
  allowed: optionalText('ALLOWED_MODELS'),
  useEnvironmentProxy: optionalText('NODE_USE_ENV_PROXY'),
  proxyVariables: Config.all(proxyVariables.map((name) => optionalText(name))),
});

function proxyEnvironment(values: readonly (string | undefined)[]): Environment {
  return Object.fromEntries(proxyVariables.map((name, index) => [name, values[index]]));
}

function invalid(problems: readonly SettingProblem[]): ModelSettingsInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new ModelSettingsInvalid({ message: `The model settings are invalid. ${listed}`, problems });
}

function configuredOf(readings: Readonly<Record<string, Reading<unknown>>>): readonly string[] {
  return Object.entries(readings)
    .filter(([, { availability }]: readonly [string, Reading<unknown>]) => availability.configured)
    .map(([provider]: readonly [string, Reading<unknown>]) => provider);
}

export const readModelSettings = Effect.fnUntraced(function* (environment: Environment) {
  const source = yield* sources.parse(settingsFrom(environment)).pipe(Effect.orDie);
  const anthropic = anthropicReading(source.anthropic);
  const openai = openAiReading(source.openai);
  const google = googleReading(source.google);
  const bedrock = bedrockReading(source.bedrock);
  const azure = azureReading(source.azure);
  const vertex = vertexReading(source.vertex);
  const gateways = yield* gatewayReading(environment, source.gateways);
  const aliases = aliasReading(source.aliases);
  const gatewayNames = gateways.gateways.map(({ name }) => name);
  const builtIns = {
    anthropic,
    openai,
    google,
    bedrock,
    'bedrock-anthropic': bedrock,
    azure,
    vertex,
    'vertex-anthropic': vertex,
  };
  const catalog = catalogReading(source.declared, source.allowed, {
    gateways: gatewayNames,
    providers: [...configuredOf(builtIns), ...gatewayNames],
    aliases: aliases.aliases,
  });
  const problems = [anthropic, openai, google, bedrock, azure, vertex, gateways, aliases, catalog].flatMap(
    (reading) => reading.problems,
  );
  if (problems.length > 0) {
    return yield* Effect.fail(invalid(problems));
  }
  const settings: ModelSettings = {
    anthropic: anthropic.availability,
    openai: openai.availability,
    google: google.availability,
    bedrock: bedrock.availability,
    azure: azure.availability,
    vertex: vertex.availability,
    gateways: gateways.gateways,
    aliases: aliases.aliases,
    declared: catalog.declared,
    allowed: catalog.allowed,
    proxy: { enabled: source.useEnvironmentProxy === '1', environment: proxyEnvironment(source.proxyVariables) },
  };
  return settings;
});
