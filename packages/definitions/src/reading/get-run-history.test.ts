import type { Decider, Presenter } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';

const toAlpha = toBrain('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

const StandInLogEventSchema = Schema.Struct({
  type: Schema.Literals(['input_applied', 'state_patched']),
  key: Schema.String,
  at: Schema.String,
});

type StandInLogEvent = typeof StandInLogEventSchema.Type;

const runLog: Decider<null, StandInLogEvent, StandInLogEvent> = {
  initialState: null,
  evolve: (state) => state,
  decide: (event) => Result.succeed([event]),
  eventSchema: StandInLogEventSchema,
};

const decodeRunLogEvent = Schema.decodeUnknownSync(StandInLogEventSchema);

const runLogPresenter: Presenter = {
  streamKind: 'run-logs',
  publicNames: { input_applied: ['input_applied'], state_patched: [] },
  present: ({ id, cursor, causationId, data }) => {
    const { key, at } = decodeRunLogEvent(data);
    return [
      {
        id,
        cursor,
        causation_id: causationId,
        at,
        type: 'input_applied',
        summary: 'An input was applied.',
        data: { key },
      },
    ];
  },
};

async function brainWithRun(presenters: readonly Presenter[] = makeDefinitionPresenters([echo])) {
  const operations = definitionOperationsFor([echo], presenters);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const executing = (id: string, at: string) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: id }), at);
  const reading = (input: object) =>
    definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, { run_id: runId, ...input }));
  const logging = (event: StandInLogEvent, recordedAt: string) =>
    definitions.run(
      Effect.orDie(definitions.ledger.service.execute(`brain/acme/alpha/run-logs/${runId}`, runLog, event)),
      recordedAt,
    );
  return { ...definitions, ...operations, executing, reading, logging };
}

function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

const nextCursorOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ next_cursor: Schema.NullOr(Schema.String) }) }),
);

function typesIn(outcome: unknown): readonly string[] {
  return Schema.decodeUnknownSync(
    Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }) }),
  )(outcome).output.events.map(({ type }) => type);
}

describe('get_run_history', () => {
  it('is a brain query at GET /runs/{run_id}/history that may meet not_found', async () => {
    const { getRunHistory } = await brainWithRun();

    expect(getRunHistory.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get run history',
      route: { method: 'GET', path: '/runs/{run_id}/history' },
      pathParameters: ['run_id'],
      reasons: ['not_found', 'invalid_input'],
    });
  });
});

describe('the history of a run', () => {
  it('holds the facts of the run oldest first, each at its own time', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(runId, '2026-10-01T09:00:10.000Z');

    expect(await reading({})).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            at: '2026-10-01T09:00:10.000Z',
            type: 'run_started',
            summary: 'A run of the greeting “greet” started.',
            data: {
              run_id: runId,
              by: 'acme-admin',
              type: 'echo',
              name: 'greet',
              definition_version: 1,
              input_bytes: 2,
            },
          },
          {
            at: '2026-10-01T09:00:10.000Z',
            type: 'run_succeeded',
            summary: 'A run finished.',
            data: { run_id: runId, by: 'acme-admin', output_bytes: 28, record_bytes: 17 },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });

  it('reads a run that finished later, newest first, from a query string with its id in any case, without its deferral', async () => {
    const { call, executing, getRunHistory, settling } = await withHandOn();
    await executing();
    await settling({ status: 'succeeded', output: 'done', record: {} });

    const read = await call(
      getRunHistory,
      asQueryString(toAlpha(acmeAdmin, { run_id: relayedId.toUpperCase(), order: 'desc' })),
    );

    expect(typesIn(read)).toEqual(['run_succeeded', 'run_started']);
    expect(read).toMatchObject({ output: { events: [{ at: settledAt }, {}] } });
  });
});

async function runWithLog(presenters?: readonly Presenter[]) {
  const brain = await brainWithRun(presenters);
  await brain.executing(runId, '2026-10-01T09:00:10.000Z');
  await brain.logging(
    { type: 'input_applied', key: 'early', at: '2026-10-01T09:00:05.000Z' },
    '2026-10-01T09:00:11.000Z',
  );
  await brain.logging(
    { type: 'state_patched', key: 'patch', at: '2026-10-01T09:00:06.000Z' },
    '2026-10-01T09:00:11.000Z',
  );
  await brain.logging(
    { type: 'input_applied', key: 'same', at: '2026-10-01T09:00:10.000Z' },
    '2026-10-01T09:00:12.000Z',
  );
  await brain.logging(
    { type: 'input_applied', key: 'late', at: '2026-10-01T09:00:20.000Z' },
    '2026-10-01T09:00:21.000Z',
  );
  return brain;
}

const keysAndTypesOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      events: Schema.Array(
        Schema.Struct({ type: Schema.String, data: Schema.Struct({ key: Schema.optionalKey(Schema.String) }) }),
      ),
    }),
  }),
);

function keysAndTypesIn(outcome: unknown): readonly string[] {
  return keysAndTypesOf(outcome).output.events.map(({ type, data }) => data.key ?? type);
}

const cursorsOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ cursor: Schema.String })) }) }),
);

function cursorsIn(outcome: unknown): readonly string[] {
  return cursorsOf(outcome).output.events.map(({ cursor }) => cursor);
}

const withRunLog = [...makeDefinitionPresenters([echo]), runLogPresenter];

async function everyKeyAndType(
  read: (cursor: string | undefined) => Promise<unknown>,
  cursor?: string,
): Promise<readonly (readonly string[])[]> {
  const page = await read(cursor);
  const next = nextCursorOf(page).output.next_cursor;
  const rest = next === null ? [] : await everyKeyAndType(read, next);
  return [keysAndTypesIn(page), ...rest];
}

describe('the history of a run with a log of its own', () => {
  it('follows the order the brain recorded both streams in, whatever the time of each event', async () => {
    const { reading } = await runWithLog(withRunLog);
    const recorded = ['run_started', 'run_succeeded', 'early', 'same', 'late'];

    expect(keysAndTypesIn(await reading({}))).toEqual(recorded);
    expect(keysAndTypesIn(await reading({ order: 'desc' }))).toEqual(recorded.toReversed());
  });

  it('reads on from the cursor of each event to the events after it, in either order', async () => {
    const { reading } = await runWithLog(withRunLog);
    const after = async (order: string) => {
      const cursors = cursorsIn(await reading({ order }));
      return Promise.all(cursors.map(async (cursor) => keysAndTypesIn(await reading({ order, cursor }))));
    };
    const recorded = ['run_started', 'run_succeeded', 'early', 'same', 'late'];

    expect([await after('asc'), await after('desc')]).toEqual([
      recorded.map((_, index) => recorded.slice(index + 1)),
      recorded.toReversed().map((_, index) => recorded.toReversed().slice(index + 1)),
    ]);
  });

  it('pages through both streams without a gap or a repeat', async () => {
    const { reading } = await runWithLog(withRunLog);

    const pages = await everyKeyAndType((cursor) => reading({ limit: 2, ...withCursor(cursor) }));

    expect(pages).toEqual([['run_started', 'run_succeeded'], ['early'], ['same', 'late']]);
  });

  it('shows the facts of the run alone when no presenter presents its log', async () => {
    const { reading } = await runWithLog();

    expect(keysAndTypesIn(await reading({}))).toEqual(['run_started', 'run_succeeded']);
  });
});

const emptyAndEnded = { status: 'succeeded', output: { events: [], has_more: false, next_cursor: null } };

describe('get_run_history rejecting', () => {
  it('a run the brain does not have, with a cursor or without', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(otherId, '2026-10-01T09:00:10.000Z');
    const notFound = {
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no run ${runId} in this brain`,
    };
    const [firstOfAnother] = cursorsIn(await reading({ run_id: otherId }));

    expect(await reading({})).toEqual(notFound);
    expect(await reading({ cursor: String(firstOfAnother) })).toEqual(notFound);
  });

  it('a cursor that does not decode', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(runId, '2026-10-01T09:00:10.000Z');

    expect(await reading({ cursor: 'not-a-cursor' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor' }],
    });
  });
});

describe('the end of the history of a run', () => {
  it('is an empty page without a cursor', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(runId, '2026-10-01T09:00:10.000Z');
    const [, last] = cursorsIn(await reading({}));

    expect(await reading({ cursor: String(last) })).toEqual(emptyAndEnded);
  });
});

describe('a page of the history of a run whose records are all hidden', () => {
  it('is empty, and the run is found', async () => {
    const { executing, reading } = await brainWithRun([]);
    await executing(runId, '2026-10-01T09:00:10.000Z');

    expect(await reading({})).toEqual(emptyAndEnded);
  });
});
