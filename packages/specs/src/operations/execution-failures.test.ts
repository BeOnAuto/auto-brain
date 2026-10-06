import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const readingTheExecution = toAlpha(acmeAdmin, { execution_id: executionId });

async function withPlain() {
  const prober = probe();
  const operations = specOperationsFor([prober.primitive]);
  const specs = harness();
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  const executing = (input: object) =>
    specs.call(
      operations.executeSpec,
      toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', execution_id: executionId, ...input }),
    );
  return { ...specs, ...operations, prober, executing };
}

const failedExecution = {
  execution_id: executionId,
  primitive: 'probe',
  name: 'plain',
  spec_version: 1,
  status: 'failed',
  started_at: firstMoment,
  started_by: 'acme-admin',
  finished_at: firstMoment,
};

describe('an execution the primitive cannot serve now', () => {
  it('is rejected with unavailable, and the rejection is recorded', async () => {
    const { call, executing, getExecution, prober } = await withPlain();
    prober.sufferOnNextRun('unavailable');

    expect(await executing({})).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The probe cannot answer now',
    });
    expect(await call(getExecution, readingTheExecution)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unavailable', detail: 'The probe cannot answer now' } },
    });
  });
});

describe('an execution that names a model the server is not set up for, while it can use others', () => {
  it('is rejected with unavailable of that kind and why, both recorded and answered again', async () => {
    const { call, executing, getExecution, prober } = await withPlain();
    prober.sufferOnNextRun('unoffered');

    expect(await executing({})).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The probe cannot reach that model, only others',
      kind: 'model_not_offered',
      because: 'provider_not_configured',
    });
    expect(await call(getExecution, readingTheExecution)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unavailable',
          detail: 'The probe cannot reach that model, only others',
          kind: 'model_not_offered',
          because: 'provider_not_configured',
        },
      },
    });
  });
});

describe('an execution of a spec the primitive cannot run as written', () => {
  it('is rejected with conflict, and the rejection is recorded', async () => {
    const { call, executing, getExecution, prober } = await withPlain();
    prober.sufferOnNextRun('conflict');

    expect(await executing({})).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe cannot run this spec as written; update it',
      kind: 'unworkable',
    });
    expect(await call(getExecution, readingTheExecution)).toStrictEqual({
      status: 'succeeded',
      output: {
        ...failedExecution,
        status: 'rejected',
        rejection: { reason: 'conflict', detail: 'The probe cannot run this spec as written; update it' },
      },
    });
  });
});

describe('an execution whose primitive finds, by running it, that its definition is unworkable', () => {
  it('is rejected with conflict of that kind, which is recorded and answered again', async () => {
    const { call, executing, getExecution, prober } = await withPlain();
    prober.sufferOnNextRun('unworkable');
    const rejection = {
      reason: 'conflict',
      detail: 'The program of the probe raised an error on line 2: stop',
      kind: 'unworkable',
    };

    expect(await executing({})).toEqual({ status: 'rejected', ...rejection });
    expect(await call(getExecution, readingTheExecution)).toStrictEqual({
      status: 'succeeded',
      output: { ...failedExecution, status: 'rejected', rejection },
    });
  });
});

describe('an execution whose primitive breaks down', () => {
  it('fails with an incident that holds the defect, and is recorded as failed', async () => {
    const { call, executing, getExecution, prober, reported } = await withPlain();
    prober.sufferOnNextRun('breakdown');

    expect(await executing({})).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported().map(({ original }) => original)).toEqual([new Error('The probe broke down')]);
    expect(await call(getExecution, readingTheExecution)).toStrictEqual({
      status: 'succeeded',
      output: failedExecution,
    });
  });

  it('fails the same way when the primitive answers with output that is not JSON', async () => {
    const { call, executing, getExecution, reported } = await withPlain();

    expect(await executing({ input: { unmeasurable: true } })).toEqual({
      status: 'failed',
      incident: reported()[0]?.id,
    });
    expect(Schema.isSchemaError(reported()[0]?.original)).toBe(true);
    expect(await call(getExecution, readingTheExecution)).toStrictEqual({
      status: 'succeeded',
      output: failedExecution,
    });
  });
});

describe('execute_spec rejecting', () => {
  it('a spec the brain does not have, and a primitive it does not know', async () => {
    const { call, executeSpec } = await withPlain();

    expect(await call(executeSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'ghost' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no probe definition ghost in this brain',
    });
    expect(await call(executeSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive echo',
    });
  });

  it('a spec whose document its primitive no longer parses, recording nothing', async () => {
    const { executing, ledger, prober } = await withPlain();
    prober.rejectEveryDocument();

    expect(await executing({})).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The probe definition plain at version 1 no longer parses (The probe document has lines it does not accept); update it',
      kind: 'unworkable',
    });
    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/specs/probe']);
  });

  it('an execution id that is not a UUID', async () => {
    const { executing } = await withPlain();

    expect(await executing({ execution_id: 'run-1' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/execution_id', detail: 'Expected a UUID' }],
    });
  });
});
