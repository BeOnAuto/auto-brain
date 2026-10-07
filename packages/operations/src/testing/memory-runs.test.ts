import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { Decider, RecordedPageRequest, RecordedSelection } from '../index.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';

const HappenedSchema = Schema.Struct({ type: Schema.String });

type Happened = typeof HappenedSchema.Type;

const happenings: Decider<null, Happened, Happened> = {
  initialState: null,
  evolve: () => null,
  decide: (happened) => Result.succeed([happened]),
  eventSchema: HappenedSchema,
};

const runsOnly: RecordedSelection = { kind: 'executions', notBeginningWith: ['execution_cancel_requested'] };

const newestHundred: RecordedPageRequest = { order: 'desc', limit: 100 };

function streamsBeginningWith(ledger: MemoryLedger, firstTypes: readonly string[]) {
  return Effect.forEach(firstTypes, (type, index) =>
    TestClock.setTime(1000 + index).pipe(
      Effect.andThen(ledger.service.execute(`brain/acme/alpha/executions/s${index}`, happenings, { type })),
    ),
  );
}

function runsWithOneLeftOutEvery(every: number, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) =>
    index % every === 0 ? 'execution_cancel_requested' : 'execution_started',
  );
}

function read(ledger: MemoryLedger, selection: RecordedSelection) {
  return ledger.service.readRecorded({ org: 'acme', brain: 'alpha' }, selection, newestHundred);
}

describe('the in-memory read of runs that leaves out the streams beginning with some types', () => {
  it('fills its page from the runs and has no more once they are read, wherever the streams left out lie', async () => {
    const among = memoryLedger();
    const oldest = memoryLedger();

    const pages = await Effect.runPromise(
      Effect.gen(function* () {
        yield* streamsBeginningWith(among, runsWithOneLeftOutEvery(21, 105));
        yield* streamsBeginningWith(oldest, runsWithOneLeftOutEvery(101, 101));
        return yield* Effect.all([read(among, runsOnly), read(oldest, runsOnly), read(oldest, { kind: 'executions' })]);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(pages.map(({ records, hasMore }) => [records.length, hasMore])).toEqual([
      [100, false],
      [100, false],
      [100, true],
    ]);
    expect(pages[0]?.records.map(({ type }) => type)).not.toContain('execution_cancel_requested');
  });
});
