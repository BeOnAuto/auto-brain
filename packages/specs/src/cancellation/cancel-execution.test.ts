import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCancelExecution } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, toBrain } from '../testing/harness.ts';
import { cancelledAt, relayedId, withHandOn } from '../testing/relaying.ts';

const asStarted = {
  execution_id: relayedId,
  primitive: 'relay',
  name: 'hand-on',
  spec_version: 1,
  status: 'started',
  started_at: firstMoment,
  started_by: 'acme-admin',
};

const everything = { kind: 'everything' } as const;

describe('cancel_execution', () => {
  it('records the request on a run that finishes later, with its caller and reason, and answers the run as it stands', async () => {
    const { cancelling, executing, history } = await withHandOn();
    await executing();

    expect(await cancelling({ reason: 'Not needed any more' })).toStrictEqual({
      status: 'succeeded',
      output: asStarted,
    });
    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'execution_started' },
          {
            type: 'execution_cancel_requested',
            at: cancelledAt,
            summary: 'Someone allowed to change the brain asked for the run to be cancelled.',
            data: { execution_id: relayedId, by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' },
          },
        ],
      },
    });
  });

  it('says who asked when no reason is given, and records nothing more when asked again before the run ended', async () => {
    const { cancelling, executing, ledger, run } = await withHandOn();
    await executing();
    await cancelling();
    await cancelling({ reason: 'Asked again' });

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', brain: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(records.filter(({ type }) => type === 'execution_cancel_requested').map(({ data }) => data)).toEqual([
      {
        type: 'execution_cancel_requested',
        kind: 'requested',
        reason: 'Cancelled at the request of acme-admin',
        primitive: 'relay',
        name: 'hand-on',
        spec_version: 1,
        by: 'acme-admin',
        at: cancelledAt,
      },
    ]);
  });
});

describe('a cancel request on a run', () => {
  it('is put in the tree of the run, caused by nothing, as a request from outside is', async () => {
    const { cancelling, executing, ledger, run } = await withHandOn();
    await executing();
    await cancelling();

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', brain: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(records.at(-1)).toMatchObject({
      type: 'execution_cancel_requested',
      causationId: null,
      correlationId: relayedId,
    });
  });

  it('is a conflict for a run that has ended, and for one that runs within its call', async () => {
    const { call, cancelling, executeSpec, executing, prober, settling } = await withHandOn();
    await executing();
    await settling({ status: 'succeeded', output: 'handed on', record: {} });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(
      executeSpec,
      toBrain('acme', 'alpha')(acmeAdmin, { primitive: 'probe', name: 'plain', execution_id: plain }),
    );
    await prober.stalled;

    expect([await cancelling(), await cancelling({}, plain)]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run has already ended, so there is nothing left to cancel',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The run runs within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
      },
    ]);
  });
});

describe('cancel_execution of a run the brain does not have, or with a reason it cannot keep', () => {
  it('is not found', async () => {
    const { cancelling } = await withHandOn();

    expect(await cancelling({}, '0199a3c4-7d2e-7c1a-9b3f-00000000ffff')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no such run in this brain',
    });
  });

  it('refuses a reason that is blank, too long or holds a control character', async () => {
    const { cancelling, executing } = await withHandOn();
    await executing();

    const refusals = [
      await cancelling({ reason: '   ' }),
      await cancelling({ reason: 'x'.repeat(1025) }),
      await cancelling({ reason: 'stop\u0007' }),
    ];

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
    ]);
  });
});

describe('the operation of cancelling a run', () => {
  const { registration } = defineCancelExecution([echo]);

  it('is a brain command at POST /executions/{execution_id}/cancel that may be rejected as not found or a conflict', () => {
    expect(registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      name: 'cancel_execution',
      title: 'Cancel run',
      route: { method: 'POST', path: '/executions/{execution_id}/cancel' },
      reasons: ['not_found', 'conflict'],
    });
  });

  it('says in plain words what it tried and that the run is being cancelled', () => {
    expect([
      registration.plainLanguage?.attempt({ execution_id: relayedId }),
      registration.plainLanguage?.outcome(
        { ...asStarted, primitive: 'echo', name: 'greet' },
        { execution_id: relayedId },
      ),
    ]).toEqual([
      'cancel the run',
      'The greeting “greet” is being cancelled: it ends as cancelled within a moment, unless it finishes first, and how it ended can be looked up then.',
    ]);
  });
});
