import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedStore, StoredRecord } from '../event-store.ts';
import { recordedEventReaderOf } from './recorded-reader.ts';

const at = '2026-10-05T09:00:00.000Z';

const context = { at, by: 'tester' };

const aCursor: unknown = expect.any(String);

const untraced: StoredRecord = {
  id: 'message-21',
  causationId: null,
  correlationId: 'r1',
  point: ['21'],
  stream: 'brain/acme/alpha/runs/r1',
  version: 1,
  globalPosition: 21,
  type: 'run_started',
  data: { input: {} },
  metadata: { context },
  recordedAt: at,
};

function storeHolding(record: StoredRecord): RecordedStore {
  return {
    pointLength: 1,
    readRecorded: () => Promise.resolve({ records: [] }),
    readAppended: () => Promise.resolve({ streams: [], through: ['21'], more: false }),
    readRecordedEvent: (_brainKey, id) => Promise.resolve(id === record.id ? record : undefined),
  };
}

describe('one record read by its id', () => {
  it('carries no trace and no span when its store kept none, and is nothing for an id the store does not hold', async () => {
    const read = recordedEventReaderOf(storeHolding(untraced));
    const alpha = { org: 'acme', brain: 'alpha' };

    const [found, missing] = await Effect.runPromise(
      Effect.all([read(alpha, 'message-21'), read(alpha, 'message-99')]),
    );

    expect(found).toEqual({
      id: 'message-21',
      cursor: aCursor,
      causationId: null,
      correlationId: 'r1',
      stream: 'brain/acme/alpha/runs/r1',
      version: 1,
      globalPosition: 21,
      type: 'run_started',
      data: { input: {} },
      context,
      recordedAt: at,
    });
    expect(missing).toBeUndefined();
  });
});
