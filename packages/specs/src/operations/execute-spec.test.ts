import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, executeSpec, getExecution, updateSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withGreetAndPlain() {
  const specs = harness();
  await specs.call(
    createSpec,
    toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  return specs;
}

function executing(name: string, input?: object) {
  const primitive = name === 'greet' ? 'echo' : 'probe';
  return toAlpha(acmeAdmin, input === undefined ? { primitive, name } : { primitive, name, ...input });
}

describe('execute_spec', () => {
  it('is a brain command at POST /specs/{primitive}/{name}/execute', () => {
    expect(executeSpec.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      title: 'Execute spec',
      route: { method: 'POST', path: '/specs/{primitive}/{name}/execute' },
      pathParameters: ['primitive', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable'],
    });
  });

  it('runs a spec with an input and answers with the execution it recorded under a new id', async () => {
    const { call, ledger } = await withGreetAndPlain();

    const outcome = await call(executeSpec, executing('greet', { input: { who: 'Ada' } }), later);
    const [, , executionStream] = ledger.streamNames();
    const id = String(executionStream).replace('brain/acme/alpha/executions/', '');

    expect(id).toMatch(uuidV7);
    expect(outcome).toStrictEqual({
      status: 'succeeded',
      output: {
        execution_id: id,
        primitive: 'echo',
        name: 'greet',
        spec_version: 1,
        status: 'succeeded',
        output: { greeting: 'Hello', input: { who: 'Ada' } },
        started_at: later,
        started_by: 'acme-admin',
        finished_at: later,
      },
    });
  });

  it('answers with the execution that get_execution reads', async () => {
    const { call } = await withGreetAndPlain();

    const executed = await call(executeSpec, executing('greet', { execution_id: executionId }));

    expect(executed).toMatchObject({ status: 'succeeded', output: { execution_id: executionId } });
    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }))).toEqual(executed);
  });
});

describe('the execution that execute_spec runs', () => {
  it('gives the primitive an empty object when the input is left out', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(executeSpec, executing('greet'))).toMatchObject({
      output: { output: { greeting: 'Hello', input: {} } },
    });
  });

  it('tells the primitive the execution id, the org, the brain and the spec it runs', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(executeSpec, executing('plain', { input: 7, execution_id: executionId }))).toMatchObject({
      output: {
        output: {
          input: 7,
          execution: { id: executionId, org: 'acme', brain: 'alpha', spec: { name: 'plain', version: 1 } },
        },
      },
    });
  });

  it('runs the active latest version of the spec', async () => {
    const { call } = await withGreetAndPlain();
    await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting": "Howdy"}' }));

    expect(await call(executeSpec, executing('greet'))).toMatchObject({
      output: { spec_version: 2, output: { greeting: 'Howdy' } },
    });
  });

  it('keeps the execution id it is given, in lowercase', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(executeSpec, executing('greet', { execution_id: executionId.toUpperCase() }))).toMatchObject({
      output: { execution_id: executionId },
    });
  });
});

describe('execute_spec rejected by the primitive', () => {
  it('for invalid input, with the issues under /input, and records the rejection', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(executeSpec, executing('plain', { input: { reject: true }, execution_id: executionId }))).toEqual(
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The probe rejects the input',
        issues: [{ detail: 'Expected anything but reject', pointer: '/input/reject' }],
      },
    );
    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }))).toStrictEqual({
      status: 'succeeded',
      output: {
        execution_id: executionId,
        primitive: 'probe',
        name: 'plain',
        spec_version: 1,
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail: 'The probe rejects the input',
          issues: [{ detail: 'Expected anything but reject', pointer: '/input/reject' }],
        },
        started_at: firstMoment,
        started_by: 'acme-admin',
        finished_at: firstMoment,
      },
    });
  });

  it('for input that is not what the primitive takes at its root', async () => {
    const { call } = await withGreetAndPlain();
    const notAnObject = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input of an echo spec must be a JSON object',
      issues: [{ detail: 'Expected a JSON object', pointer: '/input' }],
    };

    expect(await call(executeSpec, executing('greet', { input: 'Ada' }))).toEqual(notAnObject);
    expect(await call(executeSpec, executing('greet', { input: ['Ada'] }))).toEqual(notAnObject);
  });
});
