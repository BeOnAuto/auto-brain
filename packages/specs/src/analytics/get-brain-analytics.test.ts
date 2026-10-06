import type { Decider } from '@beonauto/operations';
import { Effect, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
import { defineGetBrainAnalytics } from '../index.ts';
import { acmeReader } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain, type Harness } from '../testing/harness.ts';

const getBrainAnalytics = defineGetBrainAnalytics([echo]);

const runEvents: Decider<null, readonly ExecutionEvent[], ExecutionEvent> = {
  initialState: null,
  evolve: () => null,
  decide: (events) => Result.succeed(events),
  eventSchema: ExecutionEventSchema,
};

const now = '2026-10-06T12:00:00.000Z';

const fact = { by: 'acme-admin' };

const usage = { input: { total: 1200, cache_read: 1000 }, output: { total: 300 } };

function started(name: string, at: string, primitive = 'inference'): ExecutionEvent {
  return { type: 'execution_started', primitive, name, spec_version: 1, input: {}, ...fact, at };
}

function succeeded(
  at: string,
  record: Schema.JsonObject = {},
  name = 'triage',
  primitive = 'inference',
): ExecutionEvent {
  return { type: 'execution_succeeded', output: 'ok', record, primitive, name, spec_version: 1, ...fact, at };
}

function running(specs: Harness, stream: string, ...events: readonly ExecutionEvent[]): Promise<unknown> {
  return Effect.runPromise(specs.ledger.service.execute(stream, runEvents, events));
}

async function aBrainWithRuns(): Promise<Harness> {
  const specs = harness();
  const rejection: ExecutionRejection = { reason: 'unavailable', detail: 'The answer is not JSON' };
  await running(
    specs,
    'brain/acme/alpha/executions/r1',
    started('triage', '2026-10-05T09:00:00.000Z'),
    succeeded('2026-10-05T09:00:01.000Z', { usage }),
  );
  await running(specs, 'brain/acme/alpha/executions/r2', started('triage', '2026-10-05T10:00:00.000Z'), {
    type: 'execution_rejected',
    rejection,
    record: { usage: { input: { total: 10, cache_read: 0 }, output: { total: 2 } } },
    primitive: 'inference',
    name: 'triage',
    spec_version: 1,
    ...fact,
    at: '2026-10-05T10:00:00.500Z',
  });
  await running(
    specs,
    'brain/acme/alpha/executions/r3',
    started('approval', '2026-10-06T08:00:00.000Z', 'orchestration'),
    succeeded('2026-10-06T08:00:02.000Z', {}, 'approval', 'orchestration'),
  );
  await running(specs, 'brain/acme/alpha/executions/r4', started('draft', '2026-10-06T09:00:00.000Z'));
  await running(
    specs,
    'brain/acme/alpha/executions/r5',
    started('triage', '2026-09-20T09:00:00.000Z'),
    succeeded('2026-09-20T09:00:00.400Z'),
  );
  await running(specs, 'brain/acme/beta/executions/r6', started('triage', '2026-10-06T09:00:00.000Z'));
  return specs;
}

const toAlpha = toBrain('acme', 'alpha');

function quietDay(day: string) {
  const runs = { total: 0, succeeded: 0, failed: 0, rejected: 0 };
  return { day, runs, tokens: { input: 0, output: 0, cached: 0 }, duration_ms: null };
}

const schemaRefusals: readonly (readonly [Readonly<Record<string, unknown>>, string])[] = [
  [{ days: 8 }, '/days'],
  [{ days: '7' }, '/days'],
  [{ from: '2026-02-30', to: '2026-03-01' }, '/from'],
  [{ from: '2026-10-01', to: '2026-10-6' }, '/to'],
  [{ from: '2026-10-01T24:00:00Z', to: '2026-10-02' }, '/from'],
  [{ since: '2026-10-01T00:00:00Z' }, '/since'],
];

describe('get_brain_analytics', () => {
  it('answers the last seven days by default, with every day, the runs that ended and what they used', async () => {
    const specs = await aBrainWithRuns();

    const read = await specs.call(getBrainAnalytics, toAlpha(acmeReader), now);

    expect(read).toEqual({
      status: 'succeeded',
      output: {
        days: 7,
        runs: { total: 3, succeeded: 2, failed: 0, rejected: 1 },
        tokens: { input: 1210, output: 302, cached: 1000 },
        duration_ms: { p50: 1000, p95: 2000 },
        by_day: [
          ...['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((day) => quietDay(day)),
          {
            day: '2026-10-05',
            runs: { total: 2, succeeded: 1, failed: 0, rejected: 1 },
            tokens: { input: 1210, output: 302, cached: 1000 },
            duration_ms: { p50: 1000, p95: 1000 },
          },
          {
            day: '2026-10-06',
            runs: { total: 1, succeeded: 1, failed: 0, rejected: 0 },
            tokens: { input: 0, output: 0, cached: 0 },
            duration_ms: { p50: 2000, p95: 2000 },
          },
        ],
        by_function: [
          { primitive: 'inference', name: 'triage', runs: 2 },
          { primitive: 'orchestration', name: 'approval', runs: 1 },
        ],
      },
    });
  });
});

describe('get_brain_analytics, asked for some days or some runs', () => {
  it('reads the last 30 days, or the days between two, and keeps the runs of one type or name', async () => {
    const specs = await aBrainWithRuns();
    const reading = (input: object) => specs.call(getBrainAnalytics, toAlpha(acmeReader, input), now);

    const answers = await Promise.all([
      reading({ days: 30 }),
      reading({ from: '2026-10-06', to: '2026-10-06' }),
      reading({ primitive: 'orchestration' }),
      reading({ primitive: 'inference', name: 'triage', days: 30 }),
      specs.call(getBrainAnalytics, asQueryString(toAlpha(acmeReader, { days: '14', name: 'approval' })), now),
    ]);

    expect(answers).toMatchObject([
      { output: { days: 30, runs: { total: 4 }, duration_ms: { p50: 1000, p95: 2000 } } },
      { output: { days: 1, runs: { total: 1 }, by_day: [{ day: '2026-10-06' }] } },
      { output: { runs: { total: 1 }, by_function: [{ primitive: 'orchestration', name: 'approval' }] } },
      { output: { runs: { total: 3 }, by_function: [{ name: 'triage', runs: 3 }] } },
      { output: { days: 14, runs: { total: 1 }, by_function: [{ name: 'approval' }] } },
    ]);
  });
});

describe('get_brain_analytics, given what it cannot answer', () => {
  it.each(schemaRefusals)('refuses %j as input that does not match its schema', async (input, pointer) => {
    const specs = harness();

    expect(await specs.call(getBrainAnalytics, toAlpha(acmeReader, input), now)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('refuses days with from, a day after today, and a brain it does not have', async () => {
    const specs = harness();

    const answers = await Promise.all([
      specs.call(getBrainAnalytics, toAlpha(acmeReader, { days: 7, from: '2026-10-01' }), now),
      specs.call(getBrainAnalytics, toAlpha(acmeReader, { from: '2026-10-01', to: '2026-10-07' }), now),
      specs.call(getBrainAnalytics, toBrain('acme', 'zeta')(acmeReader), now),
    ]);

    expect(answers).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The days asked for are not a window this brain can answer',
        issues: [{ pointer: '/days', detail: 'Expected days, or from and to, not both' }],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The days asked for are not a window this brain can answer',
        issues: [{ pointer: '/to', detail: 'Expected a day no later than today, 2026-10-06, in UTC' }],
      },
      { status: 'rejected', reason: 'not_found', detail: 'There is no brain zeta in this org' },
    ]);
  });
});
