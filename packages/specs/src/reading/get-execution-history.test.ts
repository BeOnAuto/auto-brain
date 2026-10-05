import type { Decider, Presenter } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeSpecPresenters } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

const RunLogEventSchema = Schema.Struct({
  type: Schema.Literals(['input_applied', 'state_patched']),
  key: Schema.String,
  at: Schema.String,
});

type RunLogEvent = typeof RunLogEventSchema.Type;

const runLog: Decider<null, RunLogEvent, RunLogEvent> = {
  initialState: null,
  evolve: (state) => state,
  decide: (event) => Result.succeed([event]),
  eventSchema: RunLogEventSchema,
};

const decodeRunLogEvent = Schema.decodeUnknownSync(RunLogEventSchema);

const runLogPresenter: Presenter = {
  streamKind: 'runs',
  publicNames: { input_applied: 'input_applied', state_patched: null },
  present: ({ id, data }) => {
    const { key, at } = decodeRunLogEvent(data);
    return { id, at, type: 'input_applied', summary: 'An input was applied.', data: { key } };
  },
};

async function brainWithRun(presenters: readonly Presenter[] = makeSpecPresenters([echo])) {
  const operations = specOperationsFor([echo], presenters);
  const specs = harness();
  await specs.call(
    operations.createSpec,
    toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const executing = (id: string, at: string) =>
    specs.call(operations.executeSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', execution_id: id }), at);
  const reading = (input: object) =>
    specs.call(operations.getExecutionHistory, toAlpha(acmeAdmin, { execution_id: executionId, ...input }));
  const logging = (event: RunLogEvent, recordedAt: string) =>
    specs.run(
      Effect.orDie(specs.ledger.service.execute(`brain/acme/alpha/runs/${executionId}`, runLog, event)),
      recordedAt,
    );
  return { ...specs, ...operations, executing, reading, logging };
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

describe('get_execution_history', () => {
  it('is a brain query at GET /executions/{execution_id}/history that may meet not_found', async () => {
    const { getExecutionHistory } = await brainWithRun();

    expect(getExecutionHistory.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get execution history',
      route: { method: 'GET', path: '/executions/{execution_id}/history' },
      pathParameters: ['execution_id'],
      reasons: ['not_found', 'invalid_input'],
    });
  });
});

describe('the history of a run', () => {
  it('holds the facts of the run oldest first, each at its own time', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(executionId, '2026-10-01T09:00:10.000Z');

    expect(await reading({})).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            at: '2026-10-01T09:00:10.000Z',
            type: 'execution_started',
            summary: 'A run of the greeting “greet” started.',
            data: {
              execution_id: executionId,
              by: 'acme-admin',
              primitive: 'echo',
              name: 'greet',
              spec_version: 1,
              input_bytes: 2,
            },
          },
          {
            at: '2026-10-01T09:00:10.000Z',
            type: 'execution_succeeded',
            summary: 'A run finished.',
            data: { execution_id: executionId, by: 'acme-admin', output_bytes: 28, record_bytes: 17 },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });

  it('reads a run that finished later, newest first, from a query string with its id in any case', async () => {
    const { call, executing, getExecutionHistory, settling } = await withHandOn();
    await executing();
    await settling({ status: 'succeeded', output: 'done', record: {} });

    const read = await call(
      getExecutionHistory,
      asQueryString(toAlpha(acmeAdmin, { execution_id: relayedId.toUpperCase(), order: 'desc' })),
    );

    expect(typesIn(read)).toEqual(['execution_succeeded', 'execution_deferred', 'execution_started']);
    expect(read).toMatchObject({ output: { events: [{ at: settledAt }, {}, {}] } });
  });
});

async function runWithLog(presenters?: readonly Presenter[]) {
  const brain = await brainWithRun(presenters);
  await brain.executing(executionId, '2026-10-01T09:00:10.000Z');
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

const withRunLog = [...makeSpecPresenters([echo]), runLogPresenter];

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
  it('merges both streams by the time of each event, then by stream, hiding what its presenter hides', async () => {
    const { reading } = await runWithLog(withRunLog);

    expect(keysAndTypesIn(await reading({}))).toEqual([
      'early',
      'execution_started',
      'execution_succeeded',
      'same',
      'late',
    ]);
    expect(keysAndTypesIn(await reading({ order: 'desc' }))).toEqual([
      'late',
      'same',
      'execution_succeeded',
      'execution_started',
      'early',
    ]);
  });

  it('pages through both streams without a gap or a repeat', async () => {
    const { reading } = await runWithLog(withRunLog);

    const pages = await everyKeyAndType((cursor) => reading({ limit: 2, ...withCursor(cursor) }));

    expect(pages).toEqual([['execution_started', 'execution_succeeded'], ['early'], ['same', 'late']]);
  });

  it('shows the facts of the run alone when no presenter presents its log', async () => {
    const { reading } = await runWithLog();

    expect(keysAndTypesIn(await reading({}))).toEqual(['execution_started', 'execution_succeeded']);
  });
});

const idsOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String })) }) }),
);

function idsIn(outcome: unknown): readonly string[] {
  return idsOf(outcome).output.events.map(({ id }) => id);
}

const emptyAndEnded = { status: 'succeeded', output: { events: [], has_more: false, next_cursor: null } };

describe('get_execution_history rejecting', () => {
  it('a run the brain does not have, with a cursor or without', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(otherId, '2026-10-01T09:00:10.000Z');
    const notFound = {
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no execution ${executionId} in this brain`,
    };
    const [firstOfAnother] = idsIn(await reading({ execution_id: otherId }));

    expect(await reading({})).toEqual(notFound);
    expect(await reading({ cursor: String(firstOfAnother) })).toEqual(notFound);
  });

  it('a cursor that does not decode', async () => {
    const { executing, reading } = await brainWithRun();
    await executing(executionId, '2026-10-01T09:00:10.000Z');

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
    await executing(executionId, '2026-10-01T09:00:10.000Z');
    const [, last] = idsIn(await reading({}));

    expect(await reading({ cursor: String(last) })).toEqual(emptyAndEnded);
  });
});

describe('a page of the history of a run whose records are all hidden', () => {
  it('is empty, and the run is found', async () => {
    const { executing, reading } = await brainWithRun([]);
    await executing(executionId, '2026-10-01T09:00:10.000Z');

    expect(await reading({})).toEqual(emptyAndEnded);
  });
});
