import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';

const { createDefinition, runDefinition, getRun, updateDefinition } = definitionOperationsFor([
  echo,
  probe().capability,
]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const greeted = {
  run_id: runId,
  type: 'echo',
  name: 'greet',
  definition_version: 1,
  status: 'succeeded',
  output: { greeting: 'Hello', input: {} },
  started_at: firstMoment,
  started_by: 'acme-admin',
  finished_at: firstMoment,
};

async function withGreetAndPlain() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));
  return definitions;
}

function running(name: string, input?: object) {
  const type = name === 'greet' ? 'echo' : 'probe';
  return toAlpha(acmeAdmin, input === undefined ? { type, name } : { type, name, ...input });
}

describe('run_definition', () => {
  it('is a brain command at POST /definitions/{type}/{name}/run', () => {
    expect(runDefinition.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      title: 'Run definition',
      route: { method: 'POST', path: '/definitions/{type}/{name}/run' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    });
  });

  it('runs a definition with an input and answers with the run it recorded under a new id', async () => {
    const { call, ledger } = await withGreetAndPlain();

    const outcome = await call(runDefinition, running('greet', { input: { who: 'Ada' } }), later);
    const [, , runStream] = ledger.streamNames();
    const id = String(runStream).replace('brain/acme/alpha/runs/', '');

    expect(id).toMatch(uuidV7);
    expect(outcome).toStrictEqual({
      status: 'succeeded',
      output: {
        run_id: id,
        type: 'echo',
        name: 'greet',
        definition_version: 1,
        status: 'succeeded',
        output: { greeting: 'Hello', input: { who: 'Ada' } },
        started_at: later,
        started_by: 'acme-admin',
        finished_at: later,
      },
    });
  });

  it('answers with the run that get_run reads, without the record that get_run adds', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('greet', { run_id: runId }))).toStrictEqual({
      status: 'succeeded',
      output: greeted,
    });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toStrictEqual({
      status: 'succeeded',
      output: { ...greeted, record: { greeting: 'Hello' } },
    });
  });
});

describe('the run that run_definition runs', () => {
  it('gives the capability an empty object when the input is left out', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('greet'))).toMatchObject({
      output: { output: { greeting: 'Hello', input: {} } },
    });
  });

  it('tells the capability the run id, the org, the brain, the caller and the definition it runs', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('plain', { input: 7, run_id: runId }))).toMatchObject({
      output: {
        output: {
          input: 7,
          run: {
            id: runId,
            org: 'acme',
            brain: 'alpha',
            caller: acmeAdmin,
            definition: { name: 'plain', version: 1 },
          },
        },
      },
    });
  });

  it('runs the active latest version of the definition', async () => {
    const { call } = await withGreetAndPlain();
    await call(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Howdy"}' }));

    expect(await call(runDefinition, running('greet'))).toMatchObject({
      output: { definition_version: 2, output: { greeting: 'Howdy' } },
    });
  });

  it('keeps the run id it is given, in lowercase', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('greet', { run_id: runId.toUpperCase() }))).toMatchObject({
      output: { run_id: runId },
    });
  });
});

describe('run_definition rejected by the capability', () => {
  it('for invalid input, with the issues under /input, and records the rejection', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('plain', { input: { reject: true }, run_id: runId }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The probe rejects the input',
      issues: [{ detail: 'Expected anything but reject', pointer: '/input/reject' }],
    });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toStrictEqual({
      status: 'succeeded',
      output: {
        run_id: runId,
        type: 'probe',
        name: 'plain',
        definition_version: 1,
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

  it('for input that is not what the capability takes at its root', async () => {
    const { call } = await withGreetAndPlain();
    const notAnObject = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input of an echo definition must be a JSON object',
      issues: [{ detail: 'Expected a JSON object', pointer: '/input' }],
    };

    expect(await call(runDefinition, running('greet', { input: 'Ada' }))).toEqual(notAnObject);
    expect(await call(runDefinition, running('greet', { input: ['Ada'] }))).toEqual(notAnObject);
  });
});
