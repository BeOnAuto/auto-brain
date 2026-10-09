import { setTimeout } from 'node:timers/promises';

import { memoryLedger } from '@beonauto/operations/testing';
import type { WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { testExpressionCheck } from '../testing/expression-checks.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-555555555551';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const startBegan = Promise.withResolvers<void>();

const slowlyStarting: Pick<WorkflowHost, 'start'> = {
  start: () =>
    Effect.promise(() => {
      startBegan.resolve();
      return setTimeout(300);
    }).pipe(Effect.as('started' as const)),
};

describe('a run whose call is cancelled while its workflow starts', () => {
  it('waits for the start and records the run waiting for the workflow it started', async () => {
    const workflow = makeWorkflowAdapter({
      runs: slowlyStarting,
      check: testExpressionCheck,
      mostDurationMs: 2_592_000_000,
      longestCallMs: 1000,
    });
    const brain = brainOn(memoryLedger(), [workflow]);
    await brain.call(brain.createDefinition, { type: 'workflow', name: 'flow', source: flow });

    const answered = await brain.callCancelledWhen(startBegan.promise, brain.runDefinition, {
      type: 'workflow',
      name: 'flow',
      run_id: runId,
    });

    expect(answered).toStrictEqual({ status: 'cancelled' });
    expect(await brain.call(brain.getRun, { run_id: runId })).toMatchObject({
      output: { status: 'started', record: {} },
    });
  });
});
