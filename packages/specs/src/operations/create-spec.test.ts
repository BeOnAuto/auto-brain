import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, retireSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const hello = '{"greeting": "Hello", "description": "Greets the caller"}';

function creating(input: object) {
  return harness().call(createSpec, toAlpha(acmeAdmin, input));
}

function creatingFrom(source: string) {
  return creating({ primitive: 'probe', name: 'plain', source });
}

describe('create_spec', () => {
  it('is a brain command at POST /specs/{primitive} that answers 201', () => {
    expect(createSpec.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      title: 'Create definition',
      route: { method: 'POST', path: '/specs/{primitive}' },
      pathParameters: ['primitive'],
      successStatus: 201,
      reasons: ['not_found', 'invalid_input', 'conflict'],
    });
  });

  it('creates an active spec at version 1 with what its primitive says about it', async () => {
    expect(await creating({ primitive: 'echo', name: 'greet', source: hello })).toStrictEqual({
      status: 'succeeded',
      output: {
        primitive: 'echo',
        name: 'greet',
        version: 1,
        status: 'active',
        media_type: 'application/json',
        description: 'Greets the caller',
        input_schema: { type: 'object' },
        output_schema: {
          type: 'object',
          properties: { greeting: { const: 'Hello' }, input: { type: 'object' } },
          required: ['greeting', 'input'],
        },
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
        source: hello,
      },
    });
  });
});

describe('the warnings of a spec', () => {
  it('are what its primitive found in the document, shown with the spec', async () => {
    const source = '{"greeting": "Hello", "warnings": ["Line 2: greeting may be too warm for some readers"]}';

    expect(await creating({ primitive: 'echo', name: 'greet', source })).toMatchObject({
      output: { warnings: ['Line 2: greeting may be too warm for some readers'] },
    });
  });

  it('are left out when the primitive found none', async () => {
    const created = await creating({ primitive: 'echo', name: 'greet', source: '{"greeting": "Hi", "warnings": []}' });

    expect(created).toMatchObject({ status: 'succeeded' });
    expect(created).not.toHaveProperty('output.warnings');
  });
});

describe('the spec create_spec records', () => {
  it('leaves out what the primitive does not say about a spec', async () => {
    expect(await creating({ primitive: 'probe', name: 'plain', source: 'just text' })).toStrictEqual({
      status: 'succeeded',
      output: {
        primitive: 'probe',
        name: 'plain',
        version: 1,
        status: 'active',
        media_type: 'text/plain',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
        source: 'just text',
      },
    });
  });

  it('records the specs of each primitive in a stream of the brain named after the primitive', async () => {
    const { call, ledger } = harness();

    await call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: hello }));
    await call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));

    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/specs/echo', 'brain/acme/alpha/specs/probe']);
  });
});

describe('create_spec rejecting a document', () => {
  it('that its primitive cannot parse, with the issues under /source, and stores nothing', async () => {
    const { call, ledger } = harness();

    expect(
      await call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'fine\noops\noops' })),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The probe document has lines it does not accept',
      issues: [
        { detail: 'Line 2 is not accepted', pointer: '/source' },
        { detail: 'Line 3 is not accepted', pointer: '/source' },
      ],
    });
    expect(ledger.streamNames()).toEqual([]);
  });

  it('of more than 65536 bytes in UTF-8, whatever its length in characters', async () => {
    const tooLong = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ detail: 'Expected a document of at most 65536 bytes in UTF-8', pointer: '/source' }],
    };

    expect(await creatingFrom('a'.repeat(65_536))).toMatchObject({ status: 'succeeded' });
    expect(await creatingFrom('é'.repeat(32_768))).toMatchObject({ status: 'succeeded' });
    expect(await creatingFrom('a'.repeat(65_537))).toEqual(tooLong);
    expect(await creatingFrom('é'.repeat(32_769))).toEqual(tooLong);
  });
});

describe('the input of create_spec', () => {
  it('rejects a malformed name and a field the operation does not know', async () => {
    expect(await creating({ primitive: 'echo', name: 'Greet', source: hello, colour: 'red' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/colour' }, { pointer: '/name' }],
    });
    expect(await creating({ primitive: 'echo', name: 'go', source: hello })).toMatchObject({
      issues: [{ pointer: '/name' }],
    });
  });

  it('rejects a primitive whose name is malformed, and answers not_found for one it does not know', async () => {
    expect(await creating({ primitive: 'Echo!', name: 'greet', source: hello })).toMatchObject({
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/primitive',
          detail: 'Expected a primitive name: 3 to 32 lowercase letters, digits and hyphens, starting with a letter',
        },
      ],
    });
    expect(await creating({ primitive: 'inference', name: 'greet', source: hello })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive inference',
    });
  });
});

describe('create_spec rejecting with conflict', () => {
  it('a name an active or a retired spec of the primitive holds', async () => {
    const { call } = harness();
    const creatingGreet = () =>
      call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: hello }));
    await creatingGreet();

    expect(await creatingGreet()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The brain already has the echo definition greet',
      kind: 'taken',
    });
    await call(retireSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet' }));
    expect(await creatingGreet()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The echo definition greet was retired, and a definition name is never reused',
      kind: 'taken',
    });
    expect(
      await call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'greet', source: 'text' })),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('when another change to the specs of the primitive landed at the same moment', async () => {
    const { dispatch, run } = harness();
    const creatingSpec = (name: string) =>
      dispatch(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name, source: hello }));

    expect(
      await run(Effect.all([creatingSpec('greet'), creatingSpec('wave')], { concurrency: 'unbounded' })),
    ).toMatchObject([
      { status: 'succeeded', output: { name: 'greet' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
