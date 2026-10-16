import { referencedVariablesOf, type Environment, type FileUse, type SettingProblem } from '@on.auto/config';
import { ConnectionPolicyInvalid, readConnectionPolicy, type ConnectionPolicy } from '@on.auto/connections';
import { Effect, Schema } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
}

const variablesTheRuntimeReads: readonly string[] = [
  'SECRETS_KEY',
  'SECRETS_KEY_PREVIOUS',
  'API_KEYS',
  'PUBLIC_URL',
  'IDENTITY_ISSUER',
  'DATABASE_URL',
  'DATABASE_CREDENTIALS',
  'CONTENT_STORE_URL',
  'MODEL_GATEWAYS',
  'TOOL_SERVERS',
  'CONNECTIONS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_API_KEY',
  'AZURE_CLIENT_SECRET',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
];

const decodeGateways = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ api_key_env: Schema.optionalKey(Schema.String) }))),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

function isGiven(text: string | undefined): text is string {
  return text !== undefined && text !== '';
}

function gatewayKeysIn(text: string | undefined): readonly string[] {
  return isGiven(text)
    ? decodeGateways(text).flatMap(({ api_key_env: name }) => (name === undefined ? [] : [name]))
    : [];
}

function referencesIn(text: string | undefined): readonly string[] {
  return isGiven(text) ? referencedVariablesOf(decodeJson(text)) : [];
}

function ownVariablesOf(environment: Environment, file: FileUse | undefined): ReadonlySet<string> {
  return new Set([
    ...variablesTheRuntimeReads,
    ...gatewayKeysIn(environment['MODEL_GATEWAYS']),
    ...referencesIn(environment['TOOL_SERVERS']),
    ...(file?.referenced ?? []),
  ]);
}

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function placed({ problems }: Problems, file: FileUse | undefined): ConnectionPolicyInvalid {
  return new ConnectionPolicyInvalid({
    message: `The connection settings are invalid. ${problemsListed(problems, file)}`,
    problems,
  });
}

export function readConnectionSettings(environment: Environment, file: FileUse | undefined): ConnectionSettings {
  const policy = readConnectionPolicy(environment, ownVariablesOf(environment, file));
  return { connections: Effect.runSync(policy.pipe(Effect.mapError((invalid: Problems) => placed(invalid, file)))) };
}
