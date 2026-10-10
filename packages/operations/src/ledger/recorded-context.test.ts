import { Effect, Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import type { Context } from './context.ts';
import { factOf, type Decider } from './decider.ts';
import { messageIdOf } from './message-lineage.ts';

const NotedSchema = factOf('noted', Schema.Struct({ note: Schema.String }));

type Noted = typeof NotedSchema.Type;

const signed: Context = { at: '2026-10-05T09:00:00.000Z', by: 'tester', runId: 'r1' };

const notes: Decider<readonly string[], string, Noted> = {
  initialState: [],
  evolve: (seen, { data, context }) => [...seen, `${data.note} by ${context.by}`],
  decide: (note) => Result.succeed([{ type: 'noted', data: { note } }]),
  context: (note) => (note === 'signed' ? signed : { at: '2026-10-05T09:00:00.000Z', by: `${note}-writer` }),
  eventSchema: NotedSchema,
};

const alpha = { org: 'acme', brain: 'alpha' };

function noting(ledger: MemoryLedger, stream: string, note: string) {
  return Effect.runPromise(ledger.service.execute(stream, notes, note));
}

describe('the in-memory context of what a brain recorded', () => {
  it('reads each record with the context it was written with and its place across the ledger', async () => {
    const ledger = memoryLedger();
    await noting(ledger, 'brain/acme/alpha/notes/n1', 'signed');
    await noting(ledger, 'brain/acme/beta/notes/n1', 'signed');
    await noting(ledger, 'brain/acme/alpha/notes/n1', 'signed');

    const page = await Effect.runPromise(
      ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 10 }),
    );

    expect(page.records.map(({ context, globalPosition, version }) => ({ context, globalPosition, version }))).toEqual([
      { context: signed, globalPosition: 1, version: 1 },
      { context: signed, globalPosition: 3, version: 2 },
    ]);
  });

  it('reads one record by its id within its brain, and nothing for an id of another brain or none', async () => {
    const ledger = memoryLedger();
    await noting(ledger, 'brain/acme/alpha/notes/n1', 'signed');
    await noting(ledger, 'brain/acme/beta/notes/n1', 'signed');

    const found = await Effect.runPromise(
      Effect.all([
        ledger.service.readRecordedEvent(alpha, messageIdOf('brain/acme/alpha/notes/n1', 1)),
        ledger.service.readRecordedEvent(alpha, messageIdOf('brain/acme/beta/notes/n1', 1)),
        ledger.service.readRecordedEvent(alpha, 'no such message'),
      ]),
    );

    expect(found[0]).toMatchObject({ type: 'noted', data: { note: 'signed' }, context: signed, version: 1 });
    expect(found.slice(1)).toEqual([undefined, undefined]);
  });
});

describe('the in-memory context of a decision', () => {
  it('refuses a context that holds a forbidden character, and appends nothing', async () => {
    const ledger = memoryLedger();
    const forbidden: Decider<readonly string[], string, Noted> = {
      ...notes,
      context: () => ({ at: '2026-10-05T09:00:00.000Z', by: 'tester\u0000' }),
    };

    const exit = await Effect.runPromiseExit(ledger.service.execute('brain/acme/alpha/notes/n1', forbidden, 'x'));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(ledger.streamNames()).toEqual([]);
  });

  it('appends nothing and asks for no context when the decider decides nothing', async () => {
    const ledger = memoryLedger();
    const silent: Decider<readonly string[], string, Noted> = {
      ...notes,
      decide: () => Result.succeed([]),
      context: () => {
        throw new Error('A decision of nothing needs no context');
      },
    };

    expect(await Effect.runPromise(ledger.service.execute('brain/acme/alpha/notes/n1', silent, 'x'))).toEqual({
      state: [],
      version: 0,
    });
  });

  it('hands the decider each event as it was recorded, its context beside its data', async () => {
    const ledger = memoryLedger();

    const states = await Effect.runPromise(
      Effect.all([
        ledger.service.execute('brain/acme/alpha/notes/n1', notes, 'first'),
        ledger.service.execute('brain/acme/alpha/notes/n1', notes, 'second'),
        ledger.service.load('brain/acme/alpha/notes/n1', notes),
      ]),
    );

    expect(states.map(({ state }) => state)).toEqual([
      ['first by first-writer'],
      ['first by first-writer', 'second by second-writer'],
      ['first by first-writer', 'second by second-writer'],
    ]);
  });
});
