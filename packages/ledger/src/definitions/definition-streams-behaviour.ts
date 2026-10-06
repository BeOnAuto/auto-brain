import { describe, expect, it, onTestFinished } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';

const created = [{ type: 'spec_created', data: { name: 'reviews' } }];

export function definitionStreamsBehaviour(entry: LedgerEntry): void {
  describe('the definition streams of a type', () => {
    it('are the streams of that type of definition in every brain, each with its version, read through an index of their own', async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();
      await store.append('brain/acme/alpha/specs/recollection', [...created, ...created], 0);
      await store.append('brain/acme/beta/specs/recollection', created, 0);
      await store.append('brain/acme/alpha/specs/inference', created, 0);
      await store.append('brain/acme/alpha/executions/run-1', created, 0);
      await store.append('brain/acme/gamma/notes/specs/recollection', created, 0);
      await store.append('brain/acme/gamma/specs/recollection/nested', created, 0);
      await store.append('org/acme/specs', created, 0);

      expect(await store.definitionStreams('recollection')).toEqual([
        { stream: 'brain/acme/alpha/specs/recollection', version: 2 },
        { stream: 'brain/acme/beta/specs/recollection', version: 1 },
      ]);
      expect(await store.definitionStreams('computation')).toEqual([]);
      expect(await entry.definitionStreamsIndexed(database)).toBe(true);
    });
  });
}
