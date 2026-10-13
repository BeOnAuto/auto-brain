import type { AppendObserver } from '@on.auto/ledger';
import type { PostgreSQLPools } from '@on.auto/ledger/postgresql';

import type { HostDatabase } from './host-database.ts';
import { openPostgreSQLDatabase } from './postgresql-database.ts';
import { openSQLiteDatabase } from './sqlite-database.ts';
import type { Statement } from './statement.ts';

export type DatabaseSettings =
  | { readonly store: 'sqlite'; readonly file: string; readonly observer?: AppendObserver | undefined }
  | { readonly store: 'postgresql'; readonly pools: PostgreSQLPools; readonly observer?: AppendObserver | undefined };

export function openHostDatabase(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
  tables: readonly Statement[] = [],
): Promise<HostDatabase> {
  return settings.store === 'sqlite'
    ? openSQLiteDatabase(settings.file, tables, settings.observer)
    : openPostgreSQLDatabase({ pools: settings.pools, reportLostConnection, tables, observer: settings.observer });
}
