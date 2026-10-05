import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  InvalidCursor,
  type Decider,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedSelection,
} from '../index.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';

const HappenedSchema = Schema.Struct({ type: Schema.String, note: Schema.String });

type Happened = typeof HappenedSchema.Type;

const happenings: Decider<null, readonly Happened[], Happened> = {
  initialState: null,
  evolve: () => null,
  decide: (happened) => Result.succeed(happened),
  eventSchema: HappenedSchema,
};

const alpha = { org: 'acme', brain: 'alpha' };

function recording(ledger: MemoryLedger, at: number, stream: string, ...types: readonly string[]) {
  return TestClock.setTime(at).pipe(
    Effect.andThen(
      ledger.service.execute(
        stream,
        happenings,
        types.map((type) => ({ type, note: type })),
      ),
    ),
  );
}

function reading(ledger: MemoryLedger, selection: RecordedSelection, page: RecordedPageRequest) {
  return ledger.service.readRecorded(alpha, selection, page);
}

function typesOf({ records }: RecordedPage): readonly string[] {
  return records.map(({ type }) => type);
}

const everything: RecordedSelection = { kind: 'everything' };

function aBrainWith(ledger: MemoryLedger) {
  return Effect.all([
    recording(ledger, 1000, 'brain/acme/alpha/executions/r1', 'execution_started'),
    recording(ledger, 1000, 'brain/acme/alpha/runs/r1', 'input_applied'),
    recording(ledger, 2000, 'brain/acme/alpha2/notes', 'noted'),
    recording(ledger, 2000, 'org/acme/brains', 'brain_created'),
    recording(ledger, 3000, 'brain/acme/alpha/executions/r1', 'execution_succeeded'),
    recording(ledger, 4000, 'brain/acme/alpha/executions/r2', 'execution_started'),
  ]);
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));
}

describe('the in-memory read of what a brain recorded', () => {
  it('reads the brain alone, in either order, resuming from the cursor of the page before', async () => {
    const ledger = memoryLedger();

    const pages = await run(
      Effect.gen(function* () {
        yield* aBrainWith(ledger);
        const first = yield* reading(ledger, everything, { order: 'asc', limit: 3 });
        const second = yield* reading(ledger, everything, { order: 'asc', limit: 3, cursor: String(first.nextCursor) });
        const newest = yield* reading(ledger, everything, { order: 'desc', limit: 3 });
        const older = yield* reading(ledger, everything, {
          order: 'desc',
          limit: 3,
          cursor: String(newest.nextCursor),
        });
        return [first, second, newest, older].map((page) => ({ types: typesOf(page), hasMore: page.hasMore }));
      }),
    );

    expect(pages).toEqual([
      { types: ['execution_started', 'input_applied', 'execution_succeeded'], hasMore: true },
      { types: ['execution_started'], hasMore: false },
      { types: ['execution_started', 'execution_succeeded', 'input_applied'], hasMore: true },
      { types: ['execution_started'], hasMore: false },
    ]);
  });
});

describe('the in-memory read of runs', () => {
  it('reads the two streams of one run, and the first and latest message of each run, newest first', async () => {
    const ledger = memoryLedger();

    const [ofRun, runs, succeeded] = await run(
      Effect.gen(function* () {
        yield* aBrainWith(ledger);
        return yield* Effect.all([
          reading(ledger, { kind: 'run', execution: 'r1' }, { order: 'asc', limit: 10 }),
          reading(ledger, { kind: 'executions' }, { order: 'desc', limit: 10 }),
          reading(ledger, { kind: 'executions' }, { order: 'desc', limit: 10, types: ['execution_succeeded'] }),
        ]);
      }),
    );

    expect(ofRun.records.map(({ stream, type }) => `${stream} ${type}`)).toEqual([
      'brain/acme/alpha/executions/r1 execution_started',
      'brain/acme/alpha/runs/r1 input_applied',
      'brain/acme/alpha/executions/r1 execution_succeeded',
    ]);
    expect(typesOf(runs)).toEqual(['execution_started', 'execution_started', 'execution_succeeded']);
    expect(runs.records.map(({ stream }) => stream)).toEqual([
      'brain/acme/alpha/executions/r2',
      'brain/acme/alpha/executions/r1',
      'brain/acme/alpha/executions/r1',
    ]);
    expect(succeeded.records.map(({ stream }) => stream)).toEqual([
      'brain/acme/alpha/executions/r1',
      'brain/acme/alpha/executions/r1',
    ]);
  });
});

describe('the in-memory read from a time or of some types', () => {
  it('starts from the first message recorded at or after a time, and keeps to the types it is given', async () => {
    const ledger = memoryLedger();

    const pages = await run(
      Effect.gen(function* () {
        yield* aBrainWith(ledger);
        return yield* Effect.all([
          reading(ledger, everything, { order: 'asc', limit: 10, since: new Date(1000).toISOString() }),
          reading(ledger, everything, { order: 'desc', limit: 10, since: new Date(2500).toISOString() }),
          reading(ledger, everything, { order: 'asc', limit: 10, since: new Date(5000).toISOString() }),
          reading(ledger, everything, { order: 'asc', limit: 10, types: ['execution_succeeded', 'input_applied'] }),
        ]);
      }),
    );

    expect(pages.map((page) => ({ types: typesOf(page), next: page.nextCursor }))).toEqual([
      { types: ['execution_started', 'input_applied', 'execution_succeeded', 'execution_started'], next: null },
      { types: ['execution_started', 'execution_succeeded'], next: null },
      { types: [], next: null },
      { types: ['input_applied', 'execution_succeeded'], next: null },
    ]);
    expect(pages[0]?.records.map(({ recordedAt }) => recordedAt).at(-1)).toBe('1970-01-01T00:00:04.000Z');
  });
});

describe('the in-memory read from a cursor', () => {
  it('refuses a cursor of another brain, or one it cannot read', async () => {
    const ledger = memoryLedger();
    const { records } = await run(
      recording(ledger, 0, 'brain/acme/beta/notes', 'noted').pipe(
        Effect.andThen(
          ledger.service.readRecorded({ org: 'acme', brain: 'beta' }, everything, { order: 'asc', limit: 1 }),
        ),
      ),
    );

    const refusals = await run(
      Effect.forEach([...records.map(({ id }) => id), 'WyJicmFpbiJd', 'not a cursor'], (cursor) =>
        Effect.flip(reading(ledger, everything, { order: 'asc', limit: 1, cursor })),
      ),
    );

    expect(refusals).toEqual([
      new InvalidCursor({ kind: 'of_another_brain' }),
      new InvalidCursor({ kind: 'malformed' }),
      new InvalidCursor({ kind: 'malformed' }),
    ]);
  });
});
