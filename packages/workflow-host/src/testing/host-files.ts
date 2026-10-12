import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plainPoolsOn } from '@on.auto/ledger/testing';
import { Function } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';
import type { Statement } from '../database/statement.ts';

export type SettingsOf = () => Promise<DatabaseSettings>;

export function aSQLiteFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-workflow-host-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'ledger.db');
}

export function onSQLite(): Promise<Extract<DatabaseSettings, { readonly store: 'sqlite' }>> {
  return Promise.resolve({ store: 'sqlite', file: aSQLiteFile() });
}

export function onPostgreSQLAt(url: string): DatabaseSettings {
  return { store: 'postgresql', pools: plainPoolsOn(url) };
}

export async function openedOn(settings: DatabaseSettings, tables: readonly Statement[] = []): Promise<HostDatabase> {
  const database = await openHostDatabase(settings, Function.constVoid, tables);
  onTestFinished(() => database.close());
  return database;
}
