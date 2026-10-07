import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { Decider, InvalidCursor, RecordedPageRequest, RecordedSelection } from '../index.ts';
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

const StartSchema = Schema.Struct({ type: Schema.String, primitive: Schema.String, name: Schema.String });

type Start = typeof StartSchema.Type;

const starts: Decider<null, Start, Start> = {
  initialState: null,
  evolve: () => null,
  decide: (start) => Result.succeed([start]),
  eventSchema: StartSchema,
};

function runsWithOneInFourOfEachDefinition(ledger: MemoryLedger) {
  return Effect.forEach(
    Array.from({ length: 28 }, (_, index) => index),
    (index) =>
      ledger.service.execute(`brain/acme/alpha/executions/r${index}`, starts, {
        type: 'execution_started',
        primitive: index % 4 === 0 ? 'orchestration' : 'inference',
        name: index % 4 === 1 ? 'qualify-enquiry' : 'summary',
      }),
    { discard: true },
  );
}

type PageFigures = readonly [records: number, hasMore: boolean];

function everyPageOf(
  ledger: MemoryLedger,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): Effect.Effect<readonly PageFigures[], InvalidCursor> {
  return Effect.gen(function* () {
    const { records, hasMore, nextCursor } = yield* ledger.service.readRecorded(
      { org: 'acme', brain: 'alpha' },
      selection,
      page,
    );
    const figures: PageFigures = [records.length, hasMore];
    return nextCursor === null
      ? [figures]
      : [figures, ...(yield* everyPageOf(ledger, selection, { ...page, cursor: nextCursor }))];
  });
}

describe('the in-memory read of the runs of one definition', () => {
  it('fills every page from the runs of the primitive or the name asked for, and has no more after the last', async () => {
    const ledger = memoryLedger();

    const pages = await Effect.runPromise(
      runsWithOneInFourOfEachDefinition(ledger).pipe(
        Effect.andThen(
          Effect.all([
            everyPageOf(ledger, { kind: 'executions', primitive: 'orchestration' }, { order: 'desc', limit: 5 }),
            everyPageOf(ledger, { kind: 'executions', name: 'qualify-enquiry' }, { order: 'desc', limit: 2 }),
            everyPageOf(ledger, { kind: 'executions', primitive: 'inference', name: 'qualify-enquiry' }, newestHundred),
            everyPageOf(ledger, { kind: 'executions', primitive: 'orchestration', name: 'summary' }, newestHundred),
            everyPageOf(
              ledger,
              { kind: 'executions', primitive: 'orchestration', name: 'qualify-enquiry' },
              newestHundred,
            ),
          ]),
        ),
      ),
    );

    expect(pages).toEqual([
      [
        [5, true],
        [2, false],
      ],
      [
        [2, true],
        [2, true],
        [2, true],
        [1, false],
      ],
      [[7, false]],
      [[7, false]],
      [[0, false]],
    ]);
  });
});
