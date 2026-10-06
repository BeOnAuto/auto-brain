import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { passOf, type PassParts } from './brain-pass.ts';
import { followedBrainsOn } from './followed-brains.ts';

const brainKey = 'brain/acme/alpha/';

interface CountedRecords {
  readonly records: PassParts['records'];
  readonly reads: () => readonly boolean[];
}

function recordAt(stream: string, position: number): RecordedEvent {
  return {
    id: `record-${position}`,
    cursor: `cursor-${position}`,
    causationId: null,
    correlationId: null,
    stream: `${brainKey}${stream}`,
    version: 1,
    type: 'note_written',
    data: null,
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

function countedRecords(pageAt: (read: number) => Effect.Effect<readonly RecordedEvent[]>): CountedRecords {
  const reads: boolean[] = [];
  return {
    records: {
      after: (_brain, _cursor, delivers) =>
        Effect.suspend(() => {
          reads.push(delivers.size > 0);
          return Effect.map(pageAt(reads.length), (records) => ({ records, hasMore: true, nextCursor: null }));
        }),
    },
    reads: () => reads,
  };
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
}

function listening(database: HostDatabase, armedBy: number) {
  return insertedListener(database, {
    runId: 'acme/alpha/r-1',
    listener: 'listener',
    brainKey,
    streamId: `${brainKey}runs/r-1`,
    armedBy,
    filters: '[{"type":"com.acme.noted"}]',
    workflow: 'wait',
    passed: false,
  });
}

async function passing(counted: CountedRecords) {
  const opened = await openedOn(await onSQLite());
  const brains = followedBrainsOn(opened);
  const pass = passOf({
    database: opened,
    records: counted.records,
    brains,
    consumers: [],
    primitive: 'orchestration',
    applySpecRecord: () => Effect.void,
    unreadable: () => Effect.void,
    passedEarly: () => Effect.void,
    registered: [],
  });
  return { database: opened, brains, pass };
}

describe('the data of the records a pass reads', () => {
  it('is read again with it, after a glance without it, while a run of the brain listens for a type of event', async () => {
    const counted = endlessNotes();
    const { database, brains, pass } = await passing(counted);
    await Effect.runPromise(brains.follow(brainKey, null));
    await Effect.runPromise(Effect.orDie(listening(database, 7)));

    await Effect.runPromise(pass(brainKey, 'signal'));

    expect(counted.reads().slice(0, 2)).toEqual([false, true]);
  });
});
