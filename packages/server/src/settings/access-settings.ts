import type { Environment } from '@on.auto/config';
import { readApiKeys, readIdentityProviders, type ApiKey, type SignInSettings } from '@on.auto/identity';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';
import { Origin, PublicUrl } from './origin.ts';

export interface AccessSettings {
  readonly allowedOrigins: readonly string[];
  readonly localMode: boolean;
  readonly logFormat: LogFormat;
  readonly logLevel: LogLevelSetting;
}

const accessSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  localMode: Config.Boolean('LOCAL_MODE').pipe(Config.withDefault(false)),
  logFormat: Config.Literals(['json', 'pretty', 'console'], 'LOG_FORMAT').pipe(Config.withDefault('json')),
  logLevel: Config.Literals(['debug', 'info', 'warn', 'error'], 'LOG_LEVEL').pipe(Config.withDefault('info')),
});

function asInvalidSettings<A>(
  parsing: Effect.Effect<A, { readonly message: string }>,
): Effect.Effect<A, InvalidSettingsError> {
  return parsing.pipe(Effect.mapError(({ message }) => new InvalidSettingsError({ message })));
}

export function readAccessSettings(environment: Environment): Effect.Effect<AccessSettings, InvalidSettingsError> {
  return asInvalidSettings(accessSettings.parse(ConfigProvider.fromEnvRecord(environment)));
}

export interface CredentialSettings {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly signIn: SignInSettings | undefined;
}

const publicUrlSetting = Config.option(Config.schema(PublicUrl, 'PUBLIC_URL'));

const publicUrlRequired =
  'PUBLIC_URL: Expected the https URL the runtime is reached at, with no path, such as https://runtime.example.com, since IDENTITY_PROVIDERS lists a provider and every token names it as its audience';

export function readCredentialSettings(environment: Environment): CredentialSettings {
  const publicUrl = Effect.runSync(
    asInvalidSettings(publicUrlSetting.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const providers = readIdentityProviders(environment);
  if (providers.length > 0 && Option.isNone(publicUrl)) {
    throw new InvalidSettingsError({ message: publicUrlRequired });
  }
  return {
    apiKeys: readApiKeys(environment),
    signIn: Option.isSome(publicUrl) && providers.length > 0 ? { providers, publicUrl: publicUrl.value } : undefined,
  };
}
