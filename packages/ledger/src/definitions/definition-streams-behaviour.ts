import { describe, expect, it, onTestFinished } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';

const created = [{ type: 'definition_created', data: { name: 'reviews' } }];

export function definitionStreamsBehaviour(entry: LedgerEntry): void {
  describe('the definition streams of a type', () => {
    it('are the streams of that type of definition in every brain, each with its version, read through an index of their own', async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();
      await store.append('brain/acme/alpha/definitions/recall', [...created, ...created], 0);
      await store.append('brain/acme/beta/definitions/recall', created, 0);
      await store.append('brain/acme/alpha/definitions/reasoning', created, 0);
      await store.append('brain/acme/alpha/runs/run-1', created, 0);
      await store.append('brain/acme/gamma/notes/definitions/recall', created, 0);
      await store.append('brain/acme/gamma/definitions/recall/nested', created, 0);
      await store.append('org/acme/definitions', created, 0);

      expect(await store.definitionStreams('recall')).toEqual([
        { stream: 'brain/acme/alpha/definitions/recall', version: 2 },
        { stream: 'brain/acme/beta/definitions/recall', version: 1 },
      ]);
      expect(await store.definitionStreams('computation')).toEqual([]);
      expect(await entry.definitionStreamsIndexed(database)).toBe(true);
    });
  });
}
