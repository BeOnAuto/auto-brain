import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBrain, retireBrain } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

function creating(input: object) {
  return harness().call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', ...input }));
}

describe('create_brain', () => {
  it('is an org command at POST /brains that answers 201 and may meet conflict', () => {
    expect(createBrain.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Create brain',
      route: { method: 'POST', path: '/brains' },
      pathParameters: [],
      successStatus: 201,
      reasons: ['conflict'],
    });
  });

  it('creates an active brain with who created it and when', async () => {
    const { call } = harness();

    expect(
      await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha', description: 'Answers sales' })),
    ).toStrictEqual({
      status: 'done',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: 'Answers sales',
        status: 'active',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
      },
    });
  });

  it('records the facts of the org in its brains stream', async () => {
    const { call, ledger } = harness();

    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(ledger.streamNames()).toEqual(['org/acme/brains']);
  });
});

describe('the input of create_brain', () => {
  it('gives a brain an empty description when none is given', async () => {
    expect(await creating({ name: 'Alpha' })).toMatchObject({ output: { description: '' } });
  });

  it('has the name and the description trimmed', async () => {
    expect(await creating({ name: '  Alpha \n', description: '\t Sales  ' })).toMatchObject({
      output: { name: 'Alpha', description: 'Sales' },
    });
  });

  it('takes a name of 1 to 100 characters, not all whitespace, and a description of up to 2000', async () => {
    expect(await creating({ name: 'A', description: '' })).toMatchObject({ status: 'done' });
    expect(await creating({ name: 'n'.repeat(100), description: 'd'.repeat(2000) })).toMatchObject({
      status: 'done',
    });
    expect(await creating({ name: '   ', description: 'd'.repeat(2001) })).toMatchObject({
      reason: 'invalid_input',
      issues: [
        { pointer: '/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/description', detail: 'Expected a value with a length of at most 2000' },
      ],
    });
    expect(await creating({ name: '', description: ` ${'d'.repeat(1999)} ` })).toMatchObject({
      issues: [
        { pointer: '/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/description', detail: 'Expected a value with a length of at most 2000' },
      ],
    });
    expect(await creating({ name: 'n'.repeat(101) })).toMatchObject({
      issues: [{ pointer: '/name', detail: 'Expected a value with a length of at most 100' }],
    });
  });
});

describe('create_brain refusing input', () => {
  it('with a malformed id or a field the operation does not know', async () => {
    expect(await creating({ brain: 'Alpha', name: 'Alpha', colour: 'red' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/colour' }, { pointer: '/brain' }],
    });
  });
});

describe('the JSON Schema of the input of create_brain', () => {
  it('tells an agent the limits of the name and the description', () => {
    expect(createBrain.registration.input.schema).toMatchObject({
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 2000 },
      },
      required: ['brain', 'name'],
      additionalProperties: false,
    });
  });
});

describe('create_brain refusing with conflict', () => {
  it('meets an id held by an active or a retired brain', async () => {
    const { call } = harness();
    const creatingAlpha = () => call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    await creatingAlpha();

    expect(await creatingAlpha()).toEqual({
      status: 'refused',
      reason: 'conflict',
      detail: 'There is already a brain alpha in this org',
    });
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }));
    expect(await creatingAlpha()).toEqual({
      status: 'refused',
      reason: 'conflict',
      detail: 'The brain alpha was retired, and a brain id is never reused',
    });
  });

  it("meets the org's brains changed while it decided", async () => {
    const { dispatch, run } = harness();
    const creatingBrain = (brain: string) => dispatch(createBrain, toAcme(acmeAdmin, { brain, name: brain }));
    const bothAtOnce = Effect.all([creatingBrain('alpha'), creatingBrain('beta')], { concurrency: 'unbounded' });

    expect(await run(bothAtOnce)).toMatchObject([
      { status: 'done', output: { id: 'alpha' } },
      { status: 'refused', reason: 'conflict' },
    ]);
  });
});
