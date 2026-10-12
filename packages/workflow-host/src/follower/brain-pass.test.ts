import type { RecordedEvent } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { passOf, type PassParts } from './brain-pass.ts';
import type { RecordConsumer } from './consumers.ts';
import { followedPlaybooksOn } from './followed-brains.ts';

const playbookKey = 'brain/acme/alpha/';

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
    stream: `${playbookKey}${stream}`,
    version: 1,
    globalPosition: position,
    type: 'note_written',
    data: null,
    context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

function countedRecords(pageAt: (read: number) => Effect.Effect<readonly RecordedEvent[]>): CountedRecords {
  const reads: boolean[] = [];
  return {
    records: {
      after: (_playbook, _cursor, delivers) =>
        Effect.suspend(() => {
          reads.push(delivers.size > 0);
          return Effect.map(pageAt(reads.length), (records) => ({
            records,
            hasMore: true,
            nextCursor: null,
            lastExamined: null,
          }));
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

function deliveringEach(delivered: (id: string) => void): RecordConsumer {
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
                  skipped: () => Effect.void,
                },
              ]
            : [],
        through: followed.record.id,
        more: false,
      }),
  };
}

function listenerFor(type: string) {
  return {
    runKey: 'acme/alpha/r-1',
    listener: 'wait',
    playbookKey,
    streamId: `${playbookKey}run-logs/r-1`,
    armedBy: 1,
    filters: JSON.stringify([{ type }]),
    workflow: 'wait',
    version: 1,
    passed: true,
  };
}

function undispatchedRun(): CountedRecords {
  return countedRecords(() => Effect.succeed([recordAt('run-logs/r-1', 1), recordAt('notes/n2', 2)]));
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
}

async function passing(
  counted: CountedRecords,
  consumers: readonly RecordConsumer[] = [],
  passedEarly: PassParts['passedEarly'] = () => Effect.void,
) {
  const opened = await openedOn(await onSQLite());
  const playbooks = followedPlaybooksOn(opened);
  const pass = passOf({
    database: opened,
    records: counted.records,
    playbooks,
    consumers,
    calls: [],
    definitionType: 'workflow',
    applyDefinitionRecord: () => Effect.succeed('applied'),
    unreadable: () => Effect.void,
    passedEarly,
    registered: [],
  });
  return { database: opened, playbooks, pass };
}

describe('a pass over the records of a playbook', () => {
  it('reads nothing of a playbook the follower does not follow', async () => {
    const counted = endlessNotes();
    const { pass } = await passing(counted);

    const end = await Effect.runPromise(pass(playbookKey, 'sweep'));

    expect([end, counted.reads()]).toEqual(['caught_up', []]);
  });

  it('reads nothing when woken by a signal while a delivery waits for the next sweep', async () => {
    const counted = endlessNotes();
    const { playbooks, pass } = await passing(counted);
    await Effect.runPromise(playbooks.follow(playbookKey, null));
    await Effect.runPromise(playbooks.save(playbookKey, { cursor: null, delivered: null, attempts: 2, waiting: true }));

    const end = await Effect.runPromise(pass(playbookKey, 'signal'));

    expect([end, counted.reads()]).toEqual(['waiting', []]);
  });

  it('reads 10 pages at most, without their data while nothing in the playbook reacts, keeps its place, and says there is more', async () => {
    const counted = endlessNotes();
    const { playbooks, pass } = await passing(counted);
    await Effect.runPromise(playbooks.follow(playbookKey, null));

    const end = await Effect.runPromise(pass(playbookKey, 'signal'));
    const followed = await Effect.runPromise(playbooks.load(playbookKey));

    expect([end, counted.reads(), followed]).toEqual([
      'more',
      Array.from({ length: 10 }, () => false),
      { playbookKey, cursor: 'cursor-10', delivered: null, attempts: 0, waiting: true },
    ]);
  });
});

describe('a pass that delivers records and then fails', () => {
  it('keeps its place after each record it delivered, so the records delivered are not delivered again', async () => {
    const delivered: string[] = [];
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, playbooks, pass } = await passing(publishedThenGone(), [consumer]);
    await Effect.runPromise(playbooks.follow(playbookKey, null));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));

    const exit = await Effect.runPromiseExit(pass(playbookKey, 'signal'));
    const followed = await Effect.runPromise(playbooks.load(playbookKey));

    expect([Exit.isFailure(exit), delivered, followed?.cursor]).toEqual([true, ['record-1', 'record-2'], 'cursor-2']);
  });
});

describe('a pass that reads the data of a type in a stream that holds no events', () => {
  it('hands the record to no consumer and passes it over', async () => {
    const delivered: string[] = [];
    const misplaced = { ...publishedAt(1), stream: `${playbookKey}notes/n1` };
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, playbooks, pass } = await passing(
      countedRecords(() => Effect.succeed([misplaced])),
      [consumer],
    );
    await Effect.runPromise(playbooks.follow(playbookKey, null));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));

    await Effect.runPromise(pass(playbookKey, 'signal'));
    const followed = await Effect.runPromise(playbooks.load(playbookKey));

    expect([delivered, followed?.cursor]).toEqual([[], 'cursor-1']);
  });
});

describe('a pass that meets a record of a run held at every sweep', () => {
  it('passes it at the twentieth sweep, and says so', async () => {
    const early: string[] = [];
    const { playbooks, pass } = await passing(undispatchedRun(), [], (key, record, sweeps) =>
      Effect.sync(() => {
        early.push(`${key} ${record.id} ${sweeps}`);
      }),
    );
    await Effect.runPromise(playbooks.follow(playbookKey, null));

    const ends = await Effect.runPromise(Effect.forEach(Array.from({ length: 20 }), () => pass(playbookKey, 'sweep')));
    const followed = await Effect.runPromise(playbooks.load(playbookKey));

    expect(ends).toEqual(Array.from({ length: 20 }, () => 'waiting'));
    expect(early).toEqual([`${playbookKey} record-1 20`]);
    expect(followed).toEqual({ playbookKey, cursor: 'cursor-2', delivered: null, attempts: 1, waiting: true });
  });
});

describe('a pass that meets a record of a run', () => {
  it('stops before it while the outputs of the record are not dispatched, and waits', async () => {
    const counted = undispatchedRun();
    const { playbooks, pass } = await passing(counted);
    await Effect.runPromise(playbooks.follow(playbookKey, null));

    const end = await Effect.runPromise(pass(playbookKey, 'signal'));
    const followed = await Effect.runPromise(playbooks.load(playbookKey));

    expect([end, followed]).toEqual([
      'waiting',
      { playbookKey, cursor: null, delivered: null, attempts: 0, waiting: true },
    ]);
  });
});
