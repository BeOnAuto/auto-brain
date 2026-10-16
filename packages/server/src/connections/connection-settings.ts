import { referencedVariablesOf, type Environment, type FileUse, type SettingProblem } from '@on.auto/config';
import { ConnectionPolicyInvalid, readConnectionPolicy, type ConnectionPolicy } from '@on.auto/connections';
import { Effect, Schema } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
}

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
