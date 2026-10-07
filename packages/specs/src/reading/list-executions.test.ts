import type { Outcome } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { relay } from '../testing/relay.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const callerChosen = 'ffffffff-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const hashedChild = '6b1e2f30-9c4d-5a8b-8e7f-0a1b2c3d4e5f';

const startedTwice = '00000000-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const listedIdsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({ executions: Schema.Array(Schema.Struct({ execution_id: Schema.String })) }),
  }),
);

function idStartsIn(outcome: Outcome): readonly string[] {
  return listedIdsOf(outcome).output.executions.map(({ execution_id: id }) => id.slice(0, 8));
}

type SpecName = readonly [primitive: string, name: string];

const greet: SpecName = ['echo', 'greet'];

const wave: SpecName = ['echo', 'wave'];

const plain: SpecName = ['probe', 'plain'];

const handOn: SpecName = ['relay', 'hand-on'];

async function brainWithRuns() {
  const prober = probe();
  const relayer = relay();
  const operations = specOperationsFor([echo, prober.primitive, relayer.primitive]);
  const specs = harness();
  const creating = (primitive: string, name: string, source: string) =>
    specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive, name, source }));
  await creating('echo', 'greet', '{"greeting":"Hi"}');
  await creating('echo', 'wave', '{"greeting":"Hey"}');
  await creating('probe', 'plain', 'plain');
  await creating('relay', 'hand-on', 'text');
  const executing = ([primitive, name]: SpecName, input: object, executionId: string, at: string) =>
    specs.call(operations.executeSpec, toAlpha(acmeAdmin, { primitive, name, input, execution_id: executionId }), at);
  const listing = (input: object = {}) => specs.call(operations.listExecutions, toAlpha(acmeAdmin, input));
  return { ...specs, ...operations, prober, executing, listing };
}

async function brainWithEveryEnding() {
  const brain = await brainWithRuns();
  const { executing, prober } = brain;
  await executing(greet, { who: 'Ada' }, callerChosen, '2026-10-01T09:01:00.000Z');
  await executing(plain, { reject: true }, hashedChild, '2026-10-01T09:02:00.000Z');
  prober.sufferOnNextRun('unavailable');
  await executing(plain, {}, startedTwice, '2026-10-01T09:03:00.000Z');
  await executing(handOn, {}, '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:04:00.000Z');
  prober.sufferOnNextRun('breakdown');
  await executing(plain, {}, '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:05:00.000Z');
  await executing(wave, {}, '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:06:00.000Z');
  await executing(plain, {}, startedTwice, '2026-10-01T09:07:00.000Z');
  return brain;
}

const everyEndingNewestFirst = [
  {
    execution_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    primitive: 'echo',
    name: 'wave',
    spec_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:06:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:06:00.000Z',
  },
  {
    execution_id: '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    primitive: 'probe',
    name: 'plain',
    spec_version: 1,
    status: 'failed',
    started_at: '2026-10-01T09:05:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:05:00.000Z',
  },
  {
    execution_id: '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    primitive: 'relay',
    name: 'hand-on',
    spec_version: 1,
    status: 'started',
    started_at: '2026-10-01T09:04:00.000Z',
    started_by: 'acme-admin',
  },
  {
    execution_id: startedTwice,
    primitive: 'probe',
    name: 'plain',
    spec_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:03:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:07:00.000Z',
  },
  {
    execution_id: hashedChild,
    primitive: 'probe',
    name: 'plain',
    spec_version: 1,
    status: 'rejected',
    rejection: { reason: 'invalid_input' },
    started_at: '2026-10-01T09:02:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:02:00.000Z',
  },
  {
    execution_id: callerChosen,
    primitive: 'echo',
    name: 'greet',
    spec_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:01:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:01:00.000Z',
  },
];

describe('list_executions', () => {
  it('is a brain query at GET /executions that names the primitives it may filter by', () => {
    const { listExecutions } = specOperationsFor([echo, probe().primitive]);

    expect(listExecutions.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'List runs',
      route: { method: 'GET', path: '/executions' },
      reasons: ['invalid_input'],
    });
    expect(listExecutions.registration.input.schema).toMatchObject({
      properties: {
        primitive: {
          type: 'string',
          enum: ['echo', 'probe'],
          description: 'Only the runs of definitions of this type: echo (greeting) or probe (probe)',
        },
      },
    });
  });

  it('lists the runs newest first by their first start, whatever their ids, without outputs, records or issues', async () => {
    const { listing } = await brainWithEveryEnding();

    expect(await listing()).toEqual({
      status: 'succeeded',
      output: {
        executions: everyEndingNewestFirst,
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('a run listed after it started again or did not go through', () => {
  it('shows a run started again and still running by its latest start, in the place of its first', async () => {
    const { callCancelledWhen, executeSpec, executing, listing, prober, call, updateSpec } = await brainWithRuns();
    prober.sufferOnNextRun('unavailable');
    await executing(plain, {}, startedTwice, '2026-10-01T09:01:00.000Z');
    await executing(greet, {}, callerChosen, '2026-10-01T09:02:00.000Z');
    await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'newer' }));
    prober.sufferOnNextRun('stall');
    const finishing = Promise.withResolvers<void>();
    const again = toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', input: {}, execution_id: startedTwice });
    const runningAgain = callCancelledWhen(finishing.promise, executeSpec, again);
    await prober.stalled;

    const listed = await listing();
    finishing.resolve();
    await runningAgain;

    expect(listed).toMatchObject({
      output: {
        executions: [
          { execution_id: callerChosen },
          { execution_id: startedTwice, status: 'started', spec_version: 2, started_at: '2026-10-01T09:00:00.000Z' },
        ],
      },
    });
  });

  it('shows the reason, kind and because of a rejection, and never its detail', async () => {
    const { executing, listing, prober } = await brainWithRuns();
    prober.sufferOnNextRun('unoffered');
    await executing(plain, {}, callerChosen, '2026-10-01T09:01:00.000Z');
    prober.sufferOnNextRun('unworkable');
    await executing(plain, {}, hashedChild, '2026-10-01T09:02:00.000Z');
    prober.sufferOnNextRun('unavailable');
    await executing(plain, {}, startedTwice, '2026-10-01T09:03:00.000Z');

    expect(await listing()).toMatchObject({
      output: {
        executions: [
          { execution_id: startedTwice, rejection: { reason: 'unavailable' } },
          { execution_id: hashedChild, rejection: { reason: 'conflict', kind: 'unworkable' } },
          {
            execution_id: callerChosen,
            rejection: { reason: 'unavailable', kind: 'model_not_offered', because: 'provider_not_configured' },
          },
        ],
      },
    });
  });
});

describe('a conflict in the list of runs', () => {
  it('shows its reason alone when it has no kind', async () => {
    const { executing, listing, prober } = await brainWithRuns();
    prober.sufferOnNextRun('conflict');
    await executing(plain, {}, callerChosen, '2026-10-01T09:01:00.000Z');

    expect(await listing()).toMatchObject({
      output: { executions: [{ execution_id: callerChosen, rejection: { reason: 'conflict' } }] },
    });
    expect(await listing()).not.toMatchObject({ output: { executions: [{ rejection: { kind: 'unworkable' } }] } });
  });
});

describe('list_executions filtering', () => {
  it.each([
    [{ status: 'succeeded' }, ['44444444', '00000000', 'ffffffff']],
    [{ status: 'rejected' }, ['6b1e2f30']],
    [{ status: 'failed' }, ['33333333']],
    [{ status: 'started' }, ['22222222']],
    [{ primitive: 'echo' }, ['44444444', 'ffffffff']],
    [{ name: 'plain' }, ['33333333', '00000000', '6b1e2f30']],
    [{ primitive: 'probe', name: 'plain', status: 'succeeded' }, ['00000000']],
    [{ primitive: 'echo', name: 'plain' }, []],
    [{ primitive: 'gone' }, []],
  ] as const)('keeps the runs %j', async (filters, kept) => {
    const { listing } = await brainWithEveryEnding();

    const listed = await listing(filters);

    expect(listed).toMatchObject({ status: 'succeeded', output: { has_more: false, next_cursor: null } });
    expect(idStartsIn(listed)).toEqual(kept);
  });

  it('reads its filters, limit and cursor from a query string', async () => {
    const { call, listExecutions } = await brainWithEveryEnding();

    expect(
      await call(listExecutions, asQueryString(toAlpha(acmeAdmin, { status: 'succeeded', limit: '1' }))),
    ).toMatchObject({
      status: 'succeeded',
      output: { executions: [{ execution_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a' }], has_more: true },
    });
  });

  it('refuses a status, name or limit it does not know', async () => {
    const { listing } = await brainWithRuns();

    expect(await listing({ status: 'deferred', name: 'No', limit: 0 })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/name' }, { pointer: '/status' }, { pointer: '/limit' }],
    });
  });
});

describe('the runs of a brain', () => {
  it('are its own alone', async () => {
    const { listing, call, listExecutions } = await brainWithEveryEnding();

    expect(await call(listExecutions, toBrain('globex', 'gamma')(globexAdmin))).toEqual({
      status: 'succeeded',
      output: { executions: [], has_more: false, next_cursor: null },
    });
    expect(await call(listExecutions, toBrain('acme', 'beta')(acmeAdmin))).toMatchObject({
      output: { executions: [] },
    });
    expect(await listing()).toMatchObject({ output: { executions: { length: 6 } } });
  });
});
