import { Conflict, NotFound } from '@beonauto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Settlement } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, toBrain } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';

const settled = {
  execution_id: relayedId,
  primitive: 'relay',
  name: 'hand-on',
  spec_version: 1,
  started_at: firstMoment,
  started_by: 'acme-admin',
  finished_at: settledAt,
};

const success: Settlement = { status: 'succeeded', output: 'handed on', record: { steps: 3 } };

const noSuchExecution = Result.fail(new NotFound({ detail: 'There is no such execution in this brain' }));

describe('settling a deferred execution', () => {
  it('records its success, which a read and a call with its id then answer, without running it again', async () => {
    const { executing, reading, relayer, settling } = await withHandOn();
    await executing();

    expect(await settling(success)).toStrictEqual(
      Result.succeed({ ...settled, status: 'succeeded', output: 'handed on' }),
    );
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: { ...settled, status: 'succeeded', output: 'handed on', record: { steps: 3 } },
    });
    expect(await executing()).toStrictEqual({
      status: 'succeeded',
      output: { ...settled, status: 'succeeded', output: 'handed on' },
    });
    expect(relayer.runs()).toBe(1);
  });

  it('is quiet when it is settled again the same way, and a conflict when settled another way', async () => {
    const { executing, settling } = await withHandOn();
    await executing();
    const first = await settling(success);

    expect(await settling(success)).toStrictEqual(first);
    expect(await settling({ status: 'failed' })).toEqual(
      Result.fail(new Conflict({ detail: 'The execution already ended with another result' })),
    );
  });
});

describe('settling a deferred execution as rejected or failed', () => {
  it('records a rejection of its input, which a call with its id answers again', async () => {
    const { executing, relayer, settling } = await withHandOn();
    await executing();

    expect(await settling({ status: 'rejected', reason: 'invalid_input', detail: 'No such customer' })).toMatchObject(
      Result.succeed({
        status: 'rejected',
        rejection: { reason: 'invalid_input', detail: 'No such customer', issues: [] },
      }),
    );
    expect(await executing()).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'No such customer',
      issues: [],
    });
    expect(relayer.runs()).toBe(1);
  });

  it('as unavailable or failed lets a call with its id run it again', async () => {
    const { executing, relayer, settling } = await withHandOn();
    await executing();
    await settling({ status: 'rejected', reason: 'unavailable', detail: 'The worker is gone' });
    await executing();
    await settling({ status: 'failed' });

    expect(await executing()).toMatchObject({ output: { status: 'started' } });
    expect(relayer.runs()).toBe(3);
  });
});

describe('settling an execution', () => {
  it('reaches only the execution of its own org, brain and id', async () => {
    const { executing, settling } = await withHandOn();
    await executing();

    expect(await settling(success, { org: 'acme', brain: 'beta', id: relayedId })).toEqual(noSuchExecution);
    expect(await settling(success, { org: 'globex', brain: 'alpha', id: relayedId })).toEqual(noSuchExecution);
    expect(
      await settling(success, { org: 'acme', brain: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }),
    ).toEqual(noSuchExecution);
    expect(await settling(success, { org: 'acme', brain: 'alpha', id: relayedId.toUpperCase() })).toMatchObject(
      Result.succeed({ execution_id: relayedId, status: 'succeeded' }),
    );
  });

  it('is not found for an address that is not well formed', async () => {
    const { settling } = await withHandOn();

    expect(await settling(success, { org: 'ac/me', brain: 'alpha', id: relayedId })).toEqual(noSuchExecution);
    expect(await settling(success, { org: 'acme', brain: 'alpha/../beta', id: relayedId })).toEqual(noSuchExecution);
    expect(await settling(success, { org: 'acme', brain: 'alpha', id: 'latest' })).toEqual(noSuchExecution);
  });

  it('is a conflict for an execution that ran within its call', async () => {
    const { call, executeSpec, settling } = await withHandOn();
    await call(
      executeSpec,
      toBrain('acme', 'alpha')(acmeAdmin, { primitive: 'probe', name: 'plain', execution_id: relayedId }),
    );

    expect(await settling(success)).toEqual(
      Result.fail(new Conflict({ detail: 'The execution already ended with another result' })),
    );
  });
});

describe('a settlement whose output is too large or is not JSON', () => {
  it('is a breakdown of the primitive that fails the execution', async () => {
    const { breakingDown, executing, reading } = await withHandOn();
    await executing();

    expect(await breakingDown({ status: 'succeeded', output: 'x'.repeat(1_048_576), record: {} })).toEqual(
      new Error('The primitive answered with 1048580 bytes to record, more than the 1048576 allowed'),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown as well when the output is not JSON', async () => {
    const { breakingDown, executing, reading } = await withHandOn();
    await executing();

    expect(Schema.isSchemaError(await breakingDown({ status: 'succeeded', output: Number.NaN, record: {} }))).toBe(
      true,
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});

describe('settling a deferred execution as a conflict', () => {
  it('records a conflict of tools called with its kind', async () => {
    const { executing, settling } = await withHandOn();
    await executing();
    const detail = 'A step met a run that may have called tools';

    expect(await settling({ status: 'rejected', reason: 'conflict', detail, kind: 'tools_called' })).toMatchObject(
      Result.succeed({ status: 'rejected', rejection: { reason: 'conflict', detail, kind: 'tools_called' } }),
    );
  });

  it('records a conflict of a kind it does not know without one', async () => {
    const { executing, settling } = await withHandOn();
    await executing();

    expect(
      await settling({ status: 'rejected', reason: 'conflict', detail: 'Clashed', kind: 'something_new' }),
    ).toStrictEqual(
      Result.succeed({ ...settled, status: 'rejected', rejection: { reason: 'conflict', detail: 'Clashed' } }),
    );
  });
});
