import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const later = '2026-10-02T14:15:00.000Z';

async function withPlain() {
  const prober = probe();
  const operations = specOperationsFor([prober.primitive, echo]);
  const specs = harness();
  const creating = (name: string) =>
    specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name, source: name }));
  await creating('plain');
  await creating('other');
  const executingOf = (primitive: string, name: string, input: object, at?: string) =>
    specs.call(operations.executeSpec, toAlpha(acmeAdmin, { primitive, name, input, execution_id: executionId }), at);
  const executing = (input: object = {}, at?: string) => executingOf('probe', 'plain', input, at);
  return { ...specs, ...operations, prober, executing, executingOf };
}

describe('an execution that succeeded', () => {
  it('is answered again for its id without running the primitive again', async () => {
    const { executing, prober } = await withPlain();
    const first = await executing({ who: 'Ada' });

    expect(first).toMatchObject({ status: 'succeeded', output: { execution_id: executionId } });
    expect(await executing({ who: 'Ada' }, later)).toEqual(first);
    expect(prober.runs()).toBe(1);
  });

  it('is answered again after its spec changed or was retired', async () => {
    const { call, executing, prober, retireSpec, updateSpec } = await withPlain();
    const first = await executing();
    await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'newer' }));

    expect(await executing()).toEqual(first);
    await call(retireSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain' }));
    expect(await executing()).toEqual(first);
    expect(prober.runs()).toBe(1);
  });
});

describe('an execution whose input the primitive rejected', () => {
  it('is rejected again for its id the same way, without running the primitive again', async () => {
    const { executing, prober } = await withPlain();
    const first = await executing({ reject: true });

    expect(first).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(await executing({ reject: true })).toEqual(first);
    expect(prober.runs()).toBe(1);
  });
});

describe('an execution id', () => {
  it('belongs to one spec and one input: another primitive, spec or input meets conflict', async () => {
    const { executing, executingOf, prober } = await withPlain();
    await executing({ who: 'Ada' });
    const taken = {
      status: 'rejected',
      reason: 'conflict',
      detail: 'The execution id belongs to an execution of another spec or with another input',
    };

    expect(await executingOf('probe', 'other', { who: 'Ada' })).toEqual(taken);
    expect(await executingOf('echo', 'plain', { who: 'Ada' })).toEqual(taken);
    expect(await executing({ who: 'Bob' })).toEqual(taken);
    expect(prober.runs()).toBe(1);
  });

  it('lets one of two calls that start it at the same moment record the start, and the other meets conflict', async () => {
    const { dispatch, executeSpec, prober, run } = await withPlain();
    const executing = dispatch(
      executeSpec,
      toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', execution_id: executionId }),
    );

    expect(await run(Effect.all([executing, executing], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded' },
      { status: 'rejected', reason: 'conflict' },
    ]);
    expect(prober.runs()).toBe(1);
  });
});

describe('an execution without a final result', () => {
  it('runs again for its id when it started and never finished', async () => {
    const { call, callWithin, executeSpec, executing, getExecution, prober } = await withPlain();
    prober.sufferOnNextRun('stall');

    expect(
      await callWithin(
        50,
        executeSpec,
        toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', input: {}, execution_id: executionId }),
      ),
    ).toEqual({ status: 'cancelled' });
    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      output: { status: 'started' },
    });
    expect(await executing({}, later)).toMatchObject({
      output: { status: 'succeeded', started_at: later, finished_at: later },
    });
    expect(prober.runs()).toBe(2);
  });

  it('runs the updated spec again for its id after the primitive found it could not run as written', async () => {
    const { call, executing, prober, updateSpec } = await withPlain();
    prober.sufferOnNextRun('conflict');

    expect(await executing()).toMatchObject({ status: 'rejected', reason: 'conflict' });
    await call(updateSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'fixed' }));
    expect(await executing()).toMatchObject({ status: 'succeeded', output: { spec_version: 2, status: 'succeeded' } });
    expect(prober.runs()).toBe(2);
  });

  it('runs again for its id after the primitive was unavailable or broke down', async () => {
    const { executing, prober } = await withPlain();
    prober.sufferOnNextRun('unavailable');
    await executing();
    prober.sufferOnNextRun('breakdown');
    await executing();

    expect(await executing()).toMatchObject({ status: 'succeeded', output: { status: 'succeeded' } });
    expect(prober.runs()).toBe(3);
  });
});
