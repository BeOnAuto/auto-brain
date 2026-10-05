import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export type LedgerSettings =
  | { readonly store: 'sqlite'; readonly file: string }
  | {
      readonly store: 'postgresql';
      readonly url: Redacted.Redacted;
      readonly host: string;
      readonly database: string;
    };

const defaultFile = 'data/ledger.db';

const postgresqlSchemes: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);

const sources = Config.all({
  file: Config.option(Config.String('LEDGER_FILE')),
  url: Config.option(Config.Redacted('DATABASE_URL')),
});

function invalid(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The ledger settings are invalid. ${detail}` });
}

function onPostgreSQL(url: Redacted.Redacted): Effect.Effect<LedgerSettings, InvalidSettingsError> {
  const parsed = URL.parse(Redacted.value(url));
  const database = parsed?.pathname.slice(1) ?? '';
  return parsed !== null && postgresqlSchemes.has(parsed.protocol) && parsed.host !== '' && database !== ''
    ? Effect.succeed({ store: 'postgresql', url, host: parsed.host, database })
    : Effect.fail(
        invalid('DATABASE_URL: Expected a PostgreSQL URL such as postgresql://user:password@host:5432/database'),
      );
}

export function readLedgerSettings(environment: Environment): Effect.Effect<LedgerSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const { file, url } = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    if (Option.isSome(file) && Option.isSome(url)) {
      return yield* Effect.fail(invalid('DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both'));
    }
    return yield* Option.match(url, {
      onNone: () =>
        Effect.succeed<LedgerSettings>({ store: 'sqlite', file: Option.getOrElse(file, () => defaultFile) }),
      onSome: onPostgreSQL,
    });
  });
}
