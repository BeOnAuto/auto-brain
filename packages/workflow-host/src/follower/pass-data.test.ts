import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
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
      after: (_brain, _cursor, withData) =>
        Effect.suspend(() => {
          reads.push(withData);
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
    filters: '[]',
    workflow: 'wait',
    passed: false,
  });
}

function armedWhileRead(database: HostDatabase): CountedRecords {
  const armed = Effect.andThen(
    database.write(
      statement`INSERT INTO workflow_runs (run_id, stream_id, dispatched_through)
        VALUES (${'acme/alpha/r-1'}, ${`${brainKey}runs/r-1`}, 1)`,
    ),
    listening(database, 1),
  );
  return countedRecords(() => Effect.as(Effect.orDie(armed), [recordAt('runs/r-1', 1), recordAt('notes/n2', 2)]));
}

async function passing(counted: CountedRecords, database?: HostDatabase) {
  const opened = database ?? (await openedOn(await onSQLite()));
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

describe('the data of the records a pass reads', () => {
  it('is read while a run of the brain listens for events', async () => {
    const counted = endlessNotes();
    const { database, brains, pass } = await passing(counted);
    await Effect.runPromise(brains.follow(brainKey, null));
    await Effect.runPromise(Effect.orDie(listening(database, 7)));

    await Effect.runPromise(pass(brainKey, 'signal'));

    expect(counted.reads()[0]).toBe(true);
  });

  it('is read again from the record of a run that armed a listener while the pass read without it', async () => {
    const database = await openedOn(await onSQLite());
    const counted = armedWhileRead(database);
    const { brains, pass } = await passing(counted, database);
    await Effect.runPromise(brains.follow(brainKey, null));

    const end = await Effect.runPromise(pass(brainKey, 'signal'));
    const followed = await Effect.runPromise(brains.load(brainKey));

    expect([end, counted.reads(), followed?.cursor]).toEqual(['more', [false], 'cursor-1']);
  });
});
