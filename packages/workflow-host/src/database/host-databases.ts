import type { HostDatabase } from './host-database.ts';
import { openPostgreSQLDatabase } from './postgresql-database.ts';
import { openSQLiteDatabase } from './sqlite-database.ts';

export type DatabaseSettings =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly connectionString: string };

export function openHostDatabase(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
): Promise<HostDatabase> {
  return settings.store === 'sqlite'
    ? openSQLiteDatabase(settings.file)
    : openPostgreSQLDatabase({ connectionString: settings.connectionString, reportLostConnection });
}
