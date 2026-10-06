import { mostExaminedInAPage, type Outcome } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionDecider } from '../execution/execution-decider.ts';
import { mostInputBytes } from '../execution/recorded-size.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const PageSchema = Schema.Struct({
  output: Schema.Struct({
    executions: Schema.optionalKey(Schema.Array(Schema.Struct({ execution_id: Schema.String }))),
    events: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String }))),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const pageOf = Schema.decodeUnknownSync(PageSchema);

function idOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

async function brainWithEchoes(count: number, input: object = {}) {
  const operations = specOperationsFor([echo]);
  const specs = harness();
  await specs.call(
    operations.createSpec,
    toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const execution = (index: number) =>
    specs.dispatch(
      operations.executeSpec,
      toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', input, execution_id: idOf(index) }),
    );
  await specs.run(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index + 1),
      execution,
    ),
  );
  const executing = (index: number) => specs.run(execution(index));
  const listing = (request: object) => specs.call(operations.listExecutions, toAlpha(acmeAdmin, request));
  const reading = (request: object) => specs.call(operations.getExecutionHistory, toAlpha(acmeAdmin, request));
  return { ...specs, ...operations, executing, listing, reading };
}

type Page = (typeof PageSchema.Type)['output'];

async function everyPage(
  read: (cursor: string | undefined) => Promise<Outcome>,
  between: () => Promise<unknown> = () => Promise.resolve(),
  cursor?: string,
): Promise<readonly Page[]> {
  const { output } = pageOf(await read(cursor));
  await between();
  const rest = output.next_cursor === null ? [] : await everyPage(read, between, output.next_cursor);
  return [output, ...rest];
}

function cursorOf({ output }: typeof PageSchema.Type): string {
  return output.next_cursor ?? 'none';
}

function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

describe('paging through the runs of a brain', () => {
  it('delivers every run once, newest first, while more runs start', async () => {
    const { executing, listing } = await brainWithEchoes(7);
    let next = 8;

    const pages = await everyPage(
      (cursor) => listing({ limit: 2, ...withCursor(cursor) }),
      async () => {
        await executing(next);
        next += 1;
      },
    );

    expect(pages.map(({ executions = [] }) => executions.map(({ execution_id: id }) => id))).toEqual([
      [idOf(7), idOf(6)],
      [idOf(5), idOf(4)],
      [idOf(3), idOf(2)],
      [idOf(1)],
    ]);
    expect(pages.map(({ has_more: hasMore }) => hasMore)).toEqual([true, true, true, false]);
  });
});

describe('the bounds of a page of runs', () => {
  it('end a page at 4 MiB of stored data, with fewer runs than its limit and a cursor', async () => {
    const { listing } = await brainWithEchoes(9, { text: 'x'.repeat(mostInputBytes - 16) });

    const pages = await everyPage((cursor) => listing(withCursor(cursor)));

    expect(pages.map(({ executions = [] }) => executions.length)).toEqual([7, 2]);
    expect(pages.map(({ has_more: hasMore, next_cursor: next }) => [hasMore, next === null])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('end a page filtered by status after looking at a thousand runs, though none matched', async () => {
    const { ledger, listing, run } = await brainWithEchoes(0);
    const starting = Array.from({ length: mostExaminedInAPage + 1 }, (_, index) =>
      ledger.service.execute(`brain/acme/alpha/executions/${idOf(index)}`, executionDecider, {
        type: 'start',
        primitive: 'echo',
        name: 'greet',
        spec_version: 1,
        calls_tools: false,
        input: {},
        by: 'acme-admin',
        at: '2026-10-01T09:00:00.000Z',
      }),
    );
    await run(Effect.orDie(Effect.all(starting)));

    const pages = await everyPage((cursor) => listing({ status: 'failed', ...withCursor(cursor) }));

    expect(
      pages.map(({ executions, has_more: hasMore, next_cursor: next }) => [executions, hasMore, next === null]),
    ).toEqual([
      [[], true, false],
      [[], false, true],
    ]);
  });

  it('carries a cursor on a page its name filter emptied', async () => {
    const { listing } = await brainWithEchoes(3);

    const { output } = pageOf(await listing({ name: 'wave', limit: 2 }));

    expect([output.executions, output.has_more, output.next_cursor === null]).toEqual([[], true, false]);
  });
});

describe('paging through the history of a run', () => {
  it('delivers every event once in either order', async () => {
    const { reading } = await brainWithEchoes(1);
    const historyOf = (order: string) =>
      everyPage((cursor) => reading({ execution_id: idOf(1), order, limit: 1, ...withCursor(cursor) }));

    const oldestFirst = await historyOf('asc');
    const newestFirst = await historyOf('desc');

    expect(oldestFirst.flatMap(({ events = [] }) => events.map(({ type }) => type))).toEqual([
      'execution_started',
      'execution_succeeded',
    ]);
    expect(newestFirst.flatMap(({ events = [] }) => events.map(({ id }) => id))).toEqual(
      oldestFirst.flatMap(({ events = [] }) => events.map(({ id }) => id)).toReversed(),
    );
  });
});

describe('a cursor', () => {
  it('that does not decode, or that another brain gave, is refused at /cursor', async () => {
    const { call, createSpec, executeSpec, listExecutions, listing } = await brainWithEchoes(2);
    const toGamma = toBrain('globex', 'gamma');
    await call(createSpec, toGamma(globexAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }));
    await call(executeSpec, toGamma(globexAdmin, { primitive: 'echo', name: 'greet' }));
    await call(executeSpec, toGamma(globexAdmin, { primitive: 'echo', name: 'greet' }));
    const ofGamma = await listing({
      cursor: cursorOf(pageOf(await call(listExecutions, toGamma(globexAdmin, { limit: 1 })))),
    });
    expect([await listing({ cursor: 'not-a-cursor' }), ofGamma]).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor is malformed',
        issues: [{ detail: 'Expected a next_cursor or an id, as a read gives it', pointer: '/cursor' }],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor was not given by a read of this brain',
        issues: [{ detail: 'Expected a next_cursor or an id that a read of this brain gave', pointer: '/cursor' }],
      },
    ]);
  });
});
