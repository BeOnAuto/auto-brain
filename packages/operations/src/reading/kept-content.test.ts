import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrainReader, keptContentOf, type RecordedEvent } from '../index.ts';
import {
  brainBoundProjectionReader,
  brainBoundRecordedReader,
  brainBoundRunOutcomesReader,
  prefixedReader,
} from '../ledger/bound-ports.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';

const brain = { org: 'acme', brain: 'alpha' };

const at = '2026-10-05T09:00:00.000Z';

function recordOf(data: unknown): RecordedEvent {
  return {
    id: 'm-1',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream: 'runs/r-1',
    version: 1,
    globalPosition: 1,
    type: 'tool_call_answered',
    data,
    context: { at, by: 'brain:alpha' },
    recordedAt: at,
  };
}

function keptOf(records: readonly RecordedEvent[], mostBytes: number, digests: readonly string[]) {
  const { service } = memoryLedger();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* service.content.put(brain, 'a1', '{"query":"x"}');
      yield* service.content.put(brain, 'r1', '{"content":[]}');
      yield* service.content.put(brain, 'r2', '{"content":[{"type":"text","text":"large"}]}');
      const content = yield* keptContentOf(records, mostBytes);
      return digests.map((digest) => content(digest));
    }).pipe(
      Effect.provideService(
        BrainReader,
        BrainReader.of({
          ...prefixedReader(service, 'brain/acme/alpha/'),
          ...brainBoundRecordedReader(service, brain),
          ...brainBoundRunOutcomesReader(service, brain),
          ...brainBoundProjectionReader(service, brain),
          readContent: (sha256) => service.content.get(brain, sha256),
        }),
      ),
    ),
  );
}

describe('the content kept for the events of a read', () => {
  it('reads the content of every digest a fact kept, within the bound of the read', async () => {
    const records = [
      recordOf({ arguments_bytes: 13, arguments_sha256: 'a1', content_kept: true }),
      recordOf({ result_bytes: 14, result_sha256: 'r1', content_kept: true }),
      recordOf({ result_bytes: 9000, result_sha256: 'r2', content_kept: true }),
    ];

    await expect(keptOf(records, 4096, ['a1', 'r1', 'r2'])).resolves.toEqual([
      '{"query":"x"}',
      '{"content":[]}',
      undefined,
    ]);
    await expect(keptOf(records, Infinity, ['r2'])).resolves.toEqual(['{"content":[{"type":"text","text":"large"}]}']);
  });

  it('reads nothing for a fact that kept no content, or for data that is not a fact of a call', async () => {
    const records = [
      recordOf({ arguments_bytes: 13, arguments_sha256: 'a1', content_kept: false }),
      recordOf({ result_sha256: 'r1', content_kept: true }),
      recordOf({ result_bytes: 14, result_sha256: 7, content_kept: true }),
      recordOf('text'),
      recordOf({ result_bytes: 14, result_sha256: 'missing', content_kept: true }),
    ];

    await expect(keptOf(records, Infinity, ['a1', 'r1', 'missing'])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
