import { Config, ConfigProvider, Effect, Result, Schema } from 'effect';

import { ApiKeySchema, type ApiKey } from './api-key.ts';
import { InvalidApiKeysError } from './invalid-api-keys-error.ts';
import { describeIssues, failureOf } from './issues.ts';

const distinctIds = Schema.makeFilter(
  (keys: readonly ApiKey[]) => new Set(keys.map(({ id }) => id)).size === keys.length || 'Key ids must be unique',
);

export const ApiKeysSchema = Schema.Array(ApiKeySchema).check(distinctIds);

const decodeApiKeys = Schema.decodeUnknownResult(Schema.fromJsonString(ApiKeysSchema), {
  onExcessProperty: 'error',
  errors: 'all',
});

const apiKeysText = Config.String('API_KEYS').pipe(Config.withDefault(''));

function withinApiKeys(keys: readonly PropertyKey[]): string {
  return `API_KEYS${keys.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('')}`;
}

export function readApiKeys(environment: Readonly<Record<string, string | undefined>>): readonly ApiKey[] | undefined {
  const text = Effect.runSync(apiKeysText.parse(ConfigProvider.fromEnvRecord(environment))).trim();
  if (text === '') {
    return undefined;
  }
  const decoded = decodeApiKeys(text);
  if (Result.isFailure(decoded)) {
    throw new InvalidApiKeysError({ message: describeIssues(failureOf(decoded.failure.issue), withinApiKeys) });
  }
  return decoded.success;
}
