import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Function } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';

export type SettingsOf = () => Promise<DatabaseSettings>;

export function aSQLiteFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-brain-workflow-host-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'ledger.db');
}

export const onSQLite: SettingsOf = () => Promise.resolve({ store: 'sqlite', file: aSQLiteFile() });

export async function openedOn(settings: DatabaseSettings): Promise<HostDatabase> {
  const database = await openHostDatabase(settings, Function.constVoid);
  onTestFinished(() => database.close());
  return database;
}
