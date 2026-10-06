import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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
      after: (_brain, _cursor, withData) =>
        Effect.suspend(() => {
          reads.push(withData);
          return Effect.map(pageAt(reads.length), (records) => ({ records, hasMore: true, nextCursor: null }));
        }),
    },
    reads: () => reads,
  };
}

function undispatchedRun(): CountedRecords {
  return countedRecords(() => Effect.succeed([recordAt('runs/r-1', 1), recordAt('notes/n2', 2)]));
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
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
  });
  return { database: opened, brains, pass };
}

describe('a pass over the records of a brain', () => {
  it('reads nothing of a brain the follower does not follow', async () => {
    const counted = endlessNotes();
    const { pass } = await passing(counted);

    const end = await Effect.runPromise(pass(brainKey, 'sweep'));

    expect([end, counted.reads()]).toEqual(['caught_up', []]);
  });

  it('reads nothing when woken by a signal while a delivery waits for the next sweep', async () => {
    const counted = endlessNotes();
    const { brains, pass } = await passing(counted);
    await Effect.runPromise(brains.follow(brainKey, null));
    await Effect.runPromise(brains.save(brainKey, { cursor: null, delivered: null, attempts: 2, waiting: true }));

    const end = await Effect.runPromise(pass(brainKey, 'signal'));

    expect([end, counted.reads()]).toEqual(['waiting', []]);
  });

  it('reads 10 pages at most, without their data while nothing in the brain reacts, keeps its place, and says there is more', async () => {
    const counted = endlessNotes();
    const { brains, pass } = await passing(counted);
    await Effect.runPromise(brains.follow(brainKey, null));

    const end = await Effect.runPromise(pass(brainKey, 'signal'));
    const followed = await Effect.runPromise(brains.load(brainKey));

    expect([end, counted.reads(), followed]).toEqual([
      'more',
      Array.from({ length: 10 }, () => false),
      { brainKey, cursor: 'cursor-10', delivered: null, attempts: 0, waiting: true },
    ]);
  });
});

describe('a pass that meets a record of a run', () => {
  it('stops before it while the outputs of the record are not dispatched, and waits', async () => {
    const counted = undispatchedRun();
    const { brains, pass } = await passing(counted);
    await Effect.runPromise(brains.follow(brainKey, null));

    const end = await Effect.runPromise(pass(brainKey, 'signal'));
    const followed = await Effect.runPromise(brains.load(brainKey));

    expect([end, followed]).toEqual([
      'waiting',
      { brainKey, cursor: null, delivered: null, attempts: 0, waiting: true },
    ]);
  });
});
