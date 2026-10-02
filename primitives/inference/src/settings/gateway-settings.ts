import { Effect, Redacted, Result, Schema } from 'effect';

import { allowedOptionProblems } from './allowed-provider-options.ts';
import { decodeJsonSetting, strictly } from './json-setting.ts';
import {
  optionalSecret,
  problem,
  settingsFrom,
  urlProblems,
  type Environment,
  type SettingProblem,
} from './setting-values.ts';

export interface GatewaySettings {
  readonly name: string;
  readonly base_url: string;
  readonly api_key: Redacted.Redacted | null;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query_params: ReadonlyMap<string, Redacted.Redacted>;
  readonly structured_outputs: boolean;
  readonly include_usage: boolean;
  readonly expose_provider_messages: boolean;
  readonly allowed_provider_options: ReadonlySet<string>;
}

interface GatewayReading {
  readonly problems: readonly SettingProblem[];
  readonly gateways: readonly GatewaySettings[];
}

interface GatewayEntry {
  readonly name: string;
  readonly base_url: string;
  readonly api_key_env?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly structured_outputs?: boolean;
  readonly include_usage?: boolean;
  readonly expose_provider_messages?: boolean;
  readonly allowed_provider_options?: readonly string[];
}

interface ReadGateway {
  readonly problems: readonly SettingProblem[];
  readonly gateway: GatewaySettings;
}

const builtInProviders: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'google',
  'bedrock',
  'bedrock-anthropic',
  'azure',
  'vertex',
  'vertex-anthropic',
]);

const setting = 'MODEL_GATEWAYS';

const gatewayName = /^[a-z][a-z0-9-]{0,31}$/u;

const decodeGateways = Schema.decodeUnknownResult(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      base_url: Schema.String,
      api_key_env: Schema.optionalKey(Schema.String),
      headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      query_params: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      structured_outputs: Schema.optionalKey(Schema.Boolean),
      include_usage: Schema.optionalKey(Schema.Boolean),
      expose_provider_messages: Schema.optionalKey(Schema.Boolean),
      allowed_provider_options: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  strictly,
);

function nameProblems(name: string, index: number, names: readonly string[]): readonly SettingProblem[] {
  if (!gatewayName.test(name)) {
    return problem(
      setting,
      `/${index}/name: Expected 1 to 32 lowercase letters, digits and hyphens, starting with a letter`,
    );
  }
  if (builtInProviders.has(name)) {
    return problem(setting, `/${index}/name: ${name} is a built-in provider`);
  }
  return names.indexOf(name) < index ? problem(setting, `/${index}/name: ${name} is used twice`) : [];
}

function secretsOf(values: Readonly<Record<string, string>> = {}): ReadonlyMap<string, Redacted.Redacted> {
  return new Map(
    Object.entries(values).map(([name, value]: readonly [string, string]) => [name, Redacted.make(value)]),
  );
}

const apiKeyOf = Effect.fnUntraced(function* (environment: Environment, name: string | undefined) {
  return name === undefined
    ? undefined
    : yield* optionalSecret(name).parse(settingsFrom(environment)).pipe(Effect.orDie);
});

const gatewayFrom = Effect.fnUntraced(function* (environment: Environment, entry: GatewayEntry, index: number) {
  const api_key = yield* apiKeyOf(environment, entry.api_key_env);
  const missingKey = entry.api_key_env !== undefined && api_key === undefined;
  const read: ReadGateway = {
    problems: [
      ...urlProblems(setting, entry.base_url).map(({ detail }) => ({
        setting,
        detail: `/${index}/base_url: ${detail}`,
      })),
      ...(missingKey ? problem(setting, `/${index}/api_key_env: The variable it names is not set`) : []),
      ...allowedOptionProblems(entry.allowed_provider_options ?? [], index),
    ],
    gateway: {
      name: entry.name,
      base_url: entry.base_url,
      api_key: api_key ?? null,
      headers: secretsOf(entry.headers),
      query_params: secretsOf(entry.query_params),
      structured_outputs: entry.structured_outputs ?? false,
      include_usage: entry.include_usage ?? false,
      expose_provider_messages: entry.expose_provider_messages ?? false,
      allowed_provider_options: new Set(entry.allowed_provider_options),
    },
  };
  return read;
});

const entriesOf = (text: string | undefined): Result.Result<readonly GatewayEntry[], readonly SettingProblem[]> =>
  text === undefined ? Result.succeed([]) : decodeJsonSetting(setting, text, decodeGateways);

export const gatewayReading = Effect.fnUntraced(function* (environment: Environment, text: string | undefined) {
  const entries = entriesOf(text);
  if (Result.isFailure(entries)) {
    const failed: GatewayReading = { problems: entries.failure, gateways: [] };
    return failed;
  }
  const names = entries.success.map((entry) => entry.name);
  const read = yield* Effect.forEach(entries.success, (entry, index) => gatewayFrom(environment, entry, index));
  const reading: GatewayReading = {
    problems: [
      ...entries.success.flatMap((entry, index) => nameProblems(entry.name, index, names)),
      ...read.flatMap((gateway) => gateway.problems),
    ],
    gateways: read.map((gateway) => gateway.gateway),
  };
  return reading;
});
