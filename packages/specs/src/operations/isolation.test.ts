import { describe, expect, it } from 'vitest';

import { acmeAdmin, acmeAlphaKeeper, acmeReader, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, executeSpec, getExecution, getSpec, listSpecs, retireSpec, updateSpec } = specOperationsFor([echo]);

const toAlpha = toBrain('acme', 'alpha');

const toBeta = toBrain('acme', 'beta');

const toGamma = toBrain('globex', 'gamma');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const greet = { primitive: 'echo', name: 'greet' };

const hello = { ...greet, source: '{"greeting": "Hello"}' };

describe('the specs and executions of a brain', () => {
  it('are invisible from another brain of the org and from a brain of another org', async () => {
    const { call, ledger } = harness();
    await call(createSpec, toAlpha(acmeAdmin, hello));
    await call(executeSpec, toAlpha(acmeAdmin, { ...greet, execution_id: executionId }));

    expect(await call(getSpec, toBeta(acmeAdmin, greet))).toMatchObject({ reason: 'not_found' });
    expect(await call(listSpecs, toGamma(globexAdmin, { primitive: 'echo' }))).toEqual({
      status: 'succeeded',
      output: { specs: [] },
    });
    expect(await call(getExecution, toBeta(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      reason: 'not_found',
    });
    expect(await call(getExecution, toGamma(globexAdmin, { execution_id: executionId }))).toMatchObject({
      reason: 'not_found',
    });
    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/specs/echo', `brain/acme/alpha/executions/${executionId}`]);
  });

  it('are apart from those of another brain that uses the same names and execution ids', async () => {
    const { call } = harness();
    await call(createSpec, toAlpha(acmeAdmin, hello));
    await call(createSpec, toGamma(globexAdmin, { ...greet, source: '{"greeting": "Hola"}' }));
    await call(executeSpec, toAlpha(acmeAdmin, { ...greet, execution_id: executionId }));

    expect(await call(executeSpec, toGamma(globexAdmin, { ...greet, execution_id: executionId }))).toMatchObject({
      output: { output: { greeting: 'Hola' }, started_by: 'globex-admin' },
    });
  });

  it('cannot be reached by a caller of another org, whether they exist or not', async () => {
    const { call } = harness();
    await call(createSpec, toAlpha(acmeAdmin, hello));
    const foreign = { status: 'rejected', reason: 'forbidden', detail: 'The caller does not belong to this org' };

    expect(await call(getSpec, toAlpha(globexAdmin, greet))).toEqual(foreign);
    expect(await call(executeSpec, toAlpha(globexAdmin, greet))).toEqual(foreign);
    expect(await call(getExecution, toAlpha(globexAdmin, { execution_id: executionId }))).toEqual(foreign);
  });
});

describe('a caller that may only read', () => {
  it('reads specs and executions, and is rejected for the commands, executing included', async () => {
    const { call } = harness();
    await call(createSpec, toAlpha(acmeAdmin, hello));
    await call(executeSpec, toAlpha(acmeAdmin, { ...greet, execution_id: executionId }));
    const readOnly = { status: 'rejected', reason: 'forbidden', detail: 'The caller lacks the brain:write permission' };

    expect(await call(createSpec, toAlpha(acmeReader, { ...hello, name: 'wave' }))).toEqual(readOnly);
    expect(await call(updateSpec, toAlpha(acmeReader, hello))).toEqual(readOnly);
    expect(await call(retireSpec, toAlpha(acmeReader, greet))).toEqual(readOnly);
    expect(await call(executeSpec, toAlpha(acmeReader, greet))).toEqual(readOnly);
    expect(await call(getSpec, toAlpha(acmeReader, greet))).toMatchObject({ status: 'succeeded' });
    expect(await call(listSpecs, toAlpha(acmeReader, { primitive: 'echo' }))).toMatchObject({ status: 'succeeded' });
    expect(await call(getExecution, toAlpha(acmeReader, { execution_id: executionId }))).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('a caller limited to some brains', () => {
  it('works with the specs of its brains and is denied every other brain', async () => {
    const { call } = harness();
    const denied = { status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this brain' };

    expect(await call(createSpec, toAlpha(acmeAlphaKeeper, hello))).toMatchObject({
      output: { created_by: 'acme-alpha-keeper' },
    });
    expect(await call(executeSpec, toAlpha(acmeAlphaKeeper, greet))).toMatchObject({ status: 'succeeded' });
    expect(await call(createSpec, toBeta(acmeAlphaKeeper, hello))).toEqual(denied);
    expect(await call(listSpecs, toBeta(acmeAlphaKeeper, { primitive: 'echo' }))).toEqual(denied);
  });
});
