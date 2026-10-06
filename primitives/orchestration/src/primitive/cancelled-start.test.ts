import { setTimeout } from 'node:timers/promises';

import { memoryLedger } from '@beonauto/operations/testing';
import type { WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-555555555551';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const startBegan = Promise.withResolvers<void>();

const slowlyStarting: Pick<WorkflowHost, 'start'> = {
  start: () =>
    Effect.promise(() => {
      startBegan.resolve();
      return setTimeout(300);
    }).pipe(Effect.as('started' as const)),
};

describe('an execution whose call is cancelled while its workflow starts', () => {
  it('waits for the start and records the execution waiting for the workflow it started', async () => {
    const orchestration = makeWorkflowAdapter({
      runs: slowlyStarting,
      mostDurationMs: 2_592_000_000,
      longestCallMs: 1000,
    });
    const brain = brainOn(memoryLedger(), [orchestration]);
    await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'flow', source: flow });

    const answered = await brain.callCancelledWhen(startBegan.promise, brain.executeSpec, {
      primitive: 'orchestration',
      name: 'flow',
      execution_id: executionId,
    });

    expect(answered).toStrictEqual({ status: 'cancelled' });
    expect(await brain.call(brain.getExecution, { execution_id: executionId })).toMatchObject({
      output: { status: 'started', record: {} },
    });
  });
});
