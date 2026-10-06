import type { RecordedEvent } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { passOf, type PassParts } from './brain-pass.ts';
import type { Consumer } from './consumers.ts';
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

function publishedAt(position: number): RecordedEvent {
  const event = {
    specversion: '1.0',
    id: `e${position}`,
    source: '/acme',
    type: 'com.acme.noted',
    time: '2026-10-01T09:00:00.000Z',
  };
  return {
    ...recordAt(`events/e${position}`, position),
    type: 'event_published',
    data: { type: 'event_published', event, filled: [], by: 'acme-admin', at: event.time },
  };
}

function publishedThenGone(): CountedRecords {
  return countedRecords((read) =>
    read <= 2 ? Effect.succeed([publishedAt(1), publishedAt(2)]) : Effect.die(new Error('The ledger went away')),
  );
}

function deliveringEach(delivered: (id: string) => void): Consumer {
  return {
    name: 'noting',
    skippedAfterSweeps: 20,
    batchOf: (followed, after) =>
      Effect.succeed({
        deliveries:
          after === undefined
            ? [
                {
                  key: followed.record.id,
                  workflow: 'note',
                  deliver: Effect.sync(() => {
                    delivered(followed.record.id);
                  }),
                },
              ]
            : [],
        through: followed.record.id,
        more: false,
      }),
    skipped: () => Effect.void,
  };
}

function undispatchedRun(): CountedRecords {
  return countedRecords(() => Effect.succeed([recordAt('runs/r-1', 1), recordAt('notes/n2', 2)]));
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
}

async function passing(
  counted: CountedRecords,
  consumers: readonly Consumer[] = [],
  passedEarly: PassParts['passedEarly'] = () => Effect.void,
) {
  const opened = await openedOn(await onSQLite());
  const brains = followedBrainsOn(opened);
  const pass = passOf({
    database: opened,
    records: counted.records,
    brains,
    consumers,
    primitive: 'orchestration',
    applySpecRecord: () => Effect.void,
    unreadable: () => Effect.void,
    passedEarly,
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

describe('a pass that delivers records and then fails', () => {
  it('keeps its place after each record it delivered, so the records delivered are not delivered again', async () => {
    const delivered: string[] = [];
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, brains, pass } = await passing(publishedThenGone(), [consumer]);
    await Effect.runPromise(brains.follow(brainKey, null));
    await Effect.runPromise(
      insertedListener(database, {
        runId: 'acme/alpha/r-1',
        listener: 'wait',
        brainKey,
        streamId: `${brainKey}runs/r-1`,
        armedBy: 1,
        filters: '[]',
        workflow: 'wait',
        passed: true,
      }),
    );

    const exit = await Effect.runPromiseExit(pass(brainKey, 'signal'));
    const followed = await Effect.runPromise(brains.load(brainKey));

    expect([Exit.isFailure(exit), delivered, followed?.cursor]).toEqual([true, ['record-1', 'record-2'], 'cursor-2']);
  });
});

describe('a pass that meets a record of a run held at every sweep', () => {
  it('passes it at the twentieth sweep, and says so', async () => {
    const early: string[] = [];
    const { brains, pass } = await passing(undispatchedRun(), [], (key, record, sweeps) =>
      Effect.sync(() => {
        early.push(`${key} ${record.id} ${sweeps}`);
      }),
    );
    await Effect.runPromise(brains.follow(brainKey, null));

    const ends = await Effect.runPromise(Effect.forEach(Array.from({ length: 20 }), () => pass(brainKey, 'sweep')));
    const followed = await Effect.runPromise(brains.load(brainKey));

    expect(ends).toEqual([...Array.from({ length: 19 }, () => 'waiting'), 'more']);
    expect(early).toEqual([`${brainKey} record-1 20`]);
    expect(followed).toEqual({ brainKey, cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false });
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
