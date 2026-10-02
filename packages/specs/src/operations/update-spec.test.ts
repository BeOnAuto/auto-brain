import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, getSpec, retireSpec, updateSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const hello = '{"greeting": "Hello", "description": "Greets the caller"}';

async function withGreet() {
  const specs = harness();
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: hello }));
  return specs;
}

function updatingGreet(source: string) {
  return toAlpha(acmeAlphaKeeper, { primitive: 'echo', name: 'greet', source });
}

describe('update_spec', () => {
  it('is a brain command at PUT /specs/{primitive}/{name}', () => {
    expect(updateSpec.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      title: 'Update spec',
      route: { method: 'PUT', path: '/specs/{primitive}/{name}' },
      pathParameters: ['primitive', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'invalid_input', 'conflict'],
    });
  });

  it('replaces the document and what the primitive says about it, at a new version', async () => {
    const { call } = await withGreet();

    expect(await call(updateSpec, updatingGreet('{"greeting": "Howdy"}'), later)).toStrictEqual({
      status: 'succeeded',
      output: {
        primitive: 'echo',
        name: 'greet',
        version: 2,
        status: 'active',
        media_type: 'application/json',
        input_schema: { type: 'object' },
        output_schema: {
          type: 'object',
          properties: { greeting: { const: 'Howdy' }, input: { type: 'object' } },
          required: ['greeting', 'input'],
        },
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: later,
        source: '{"greeting": "Howdy"}',
      },
    });
    expect(await call(updateSpec, updatingGreet(hello), later)).toMatchObject({
      output: { version: 3, description: 'Greets the caller' },
    });
  });

  it('succeeds and records nothing when the document is the same', async () => {
    const { call } = await withGreet();

    expect(await call(updateSpec, updatingGreet(hello), later)).toMatchObject({
      status: 'succeeded',
      output: { version: 1, updated_at: firstMoment },
    });
  });
});

describe('update_spec rejecting', () => {
  it('a document its primitive cannot parse, keeping the spec as it was', async () => {
    const { call } = await withGreet();

    expect(await call(updateSpec, updatingGreet('{"greeting": 7}'))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The echo document is not a JSON object with a string greeting',
      issues: [{ detail: 'Expected string\n  at ["greeting"]', pointer: '/source' }],
    });
    expect(await call(getSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet' }))).toMatchObject({
      output: { version: 1, source: hello },
    });
  });

  it('a spec the brain does not have, a retired spec and a primitive it does not know', async () => {
    const { call } = await withGreet();
    await call(retireSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet' }));

    expect(await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'wave', source: hello }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo spec wave in this brain',
    });
    expect(await call(updateSpec, updatingGreet('{"greeting": "Howdy"}'))).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The echo spec greet is retired and can no longer change',
      conflict: 'retired',
    });
    expect(await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'prompt', name: 'greet', source: hello }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive prompt',
    });
  });

  it('with conflict when another change to the specs of the primitive landed at the same moment', async () => {
    const { call, dispatch, run } = await withGreet();
    await call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'wave', source: hello }));
    const updating = (name: string) =>
      dispatch(updateSpec, toAlpha(acmeAdmin, { primitive: 'echo', name, source: '{"greeting": "Yo"}' }));

    expect(await run(Effect.all([updating('greet'), updating('wave')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { name: 'greet', version: 2 } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
