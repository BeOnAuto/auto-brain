import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedger } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

describe("the brain's indexes on SQLite", () => {
  it('are created when the ledger opens, once however often it opens', async () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    const first = await openLedger(fileName);
    await first.dispose();
    const second = await openLedger(fileName);
    await second.dispose();

    const database = new DatabaseSync(fileName, { readOnly: true });
    onTestFinished(() => {
      database.close();
    });

    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ledger%' ORDER BY name")
        .all(),
    ).toEqual([
      { name: 'ledger_first_messages_by_kind' },
      { name: 'ledger_messages_by_brain' },
      { name: 'ledger_messages_by_brain_and_time' },
    ]);
  });
});
