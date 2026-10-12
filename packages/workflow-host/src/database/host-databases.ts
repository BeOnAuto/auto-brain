import type { HostDatabase } from './host-database.ts';
import { openPostgreSQLDatabase } from './postgresql-database.ts';
import { openSQLiteDatabase } from './sqlite-database.ts';
import type { Statement } from './statement.ts';

export type DatabaseSettings =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly connectionString: string };

export function openHostDatabase(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
  tables: readonly Statement[] = [],
): Promise<HostDatabase> {
  return settings.store === 'sqlite'
    ? openSQLiteDatabase(settings.file, tables)
    : openPostgreSQLDatabase({ connectionString: settings.connectionString, reportLostConnection, tables });
}
