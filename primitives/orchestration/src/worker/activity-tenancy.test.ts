import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeSpecThroughActivity, executeSpecTwiceThroughActivity } from '../testing/activity-caller.ts';
import { temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { acmeCaller } from '../testing/workflows.ts';

let harness: TemporalHarness;

beforeAll(async () => {
  harness = await temporalHarness('activity-tenancy', {
    respond: () => ({ status: 'succeeded', output: 'answered' }),
  });
}, 60_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

const call = {
  org: 'acme',
  brain: 'alpha',
  caller: acmeCaller,
  reference: '/do/0/ask',
  run: 1,
  primitive: 'inference',
  name: 'ask',
  input: {},
};

function target(workflowId: string) {
  return { address: harness.settings.address, taskQueue: harness.settings.taskQueue, workflowId };
}

describe('the activity that executes a spec, scheduled by any workflow', () => {
  it('runs the call for a workflow of the same org and brain', async () => {
    expect(await executeSpecThroughActivity(target(`acme/alpha/flow/${randomUUID()}`), call)).toStrictEqual({
      status: 'succeeded',
      output: 'answered',
    });
  }, 60_000);

  it('runs a call twice for one workflow under one nested execution id', async () => {
    const before = harness.executions().length;

    expect(await executeSpecTwiceThroughActivity(target(`acme/alpha/flow/${randomUUID()}`), call)).toStrictEqual([
      { status: 'succeeded', output: 'answered' },
      { status: 'succeeded', output: 'answered' },
    ]);
    expect(
      new Set(
        harness
          .executions()
          .slice(before)
          .map(({ executionId }) => executionId),
      ).size,
    ).toBe(1);
  }, 60_000);

  it('refuses the call for a workflow of another brain', async () => {
    const workflowId = `globex/gamma/flow/${randomUUID()}`;
    const before = harness.executions().length;

    await expect(executeSpecThroughActivity(target(workflowId), call)).rejects.toMatchObject({
      cause: { cause: { type: 'TenancyViolation' } },
    });
    expect(harness.executions()).toHaveLength(before);
  }, 60_000);
});
