import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withPlain() {
  const operations = specOperationsFor([probe().primitive]);
  const specs = harness();
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  const executing = (input: unknown, id = executionId) =>
    specs.call(
      operations.executeSpec,
      toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', input, execution_id: id }),
    );
  return { ...specs, ...operations, executing };
}

const inputTooLarge = {
  status: 'rejected',
  reason: 'invalid_input',
  detail: 'The input does not match the input schema',
  issues: [{ detail: 'Expected an input of at most 262144 bytes as JSON in UTF-8', pointer: '/input' }],
};

describe('the input of an execution', () => {
  it('may take 262144 bytes as JSON in UTF-8, whatever its length in characters', async () => {
    const { executing } = await withPlain();

    expect(await executing('a'.repeat(262_142))).toMatchObject({ status: 'succeeded' });
    expect(await executing('é'.repeat(131_071), '0199a3c4-7d2e-7c1a-9b3f-000000000002')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('is rejected above that, before anything is recorded', async () => {
    const { executing, ledger } = await withPlain();

    expect(await executing('a'.repeat(262_143))).toEqual(inputTooLarge);
    expect(await executing({ text: 'é'.repeat(131_070) })).toEqual(inputTooLarge);
    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/specs/probe']);
  });
});

describe('the output and the record of an execution', () => {
  it('may take 1048576 bytes together as JSON in UTF-8', async () => {
    const { executing } = await withPlain();

    expect(await executing({ bulk: 1_048_572 })).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
  });

  it('fail the execution above that, as a breakdown of the primitive that is recorded', async () => {
    const { call, executing, getExecution, reported } = await withPlain();

    expect(await executing({ bulk: 1_048_573 })).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported().map(({ original }) => original)).toEqual([
      new Error('The primitive answered with 1048577 bytes to record, more than the 1048576 allowed'),
    ]);
    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      output: { status: 'failed' },
    });
  });
});
