import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';

let harness: TemporalHarness;

const nestedAnswers = Promise.withResolvers<void>();

beforeAll(async () => {
  harness = await temporalHarness('settling-first', {
    nestedExecutions: 1,
    answerWhen: () => nestedAnswers.promise,
    heartbeatEveryMs: 100,
  });
}, 60_000);

afterAll(async () => {
  nestedAnswers.resolve();
  await harness.close();
}, 60_000);

async function untilNestedExecutionsStarted(count: number): Promise<void> {
  if (harness.executions().length < count) {
    await setTimeout(50);
    await untilNestedExecutionsStarted(count);
  }
}

async function lastHeartbeatOf(workflowId: string, attempts: number): Promise<unknown> {
  const { raw } = await harness.temporal.workflow.getHandle(workflowId).describe();
  const heartbeat = raw.pendingActivities?.[0]?.lastHeartbeatTime;
  if ((heartbeat !== null && heartbeat !== undefined) || attempts <= 1) {
    return heartbeat;
  }
  await setTimeout(100);
  return lastHeartbeatOf(workflowId, attempts - 1);
}

describe('a workflow settling while every slot for nested executions is taken', () => {
  it('settles at once, since settling takes no such slot, while the nested execution heartbeats', async () => {
    const asking = runFor(
      workflow('do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: ask } }'),
      '0199a3c4-7d2e-7c1a-9b3f-666666666661',
    );
    const ending = runFor(workflow('do:\n  - done: { set: { done: true } }'), '0199a3c4-7d2e-7c1a-9b3f-666666666662');
    const asked = await Effect.runPromise(harness.orchestration.start(asking));
    await untilNestedExecutionsStarted(1);

    const ended = await Effect.runPromise(harness.orchestration.start(ending));
    const outcome = await Promise.race([
      harness.temporal.workflow
        .getHandle(ended.workflowId)
        .result()
        .then(() => 'settled'),
      setTimeout(15_000, 'waiting behind the nested execution'),
    ]);
    const settledWhileAsking = harness.settled().map(({ address }) => address.id);
    const heartbeat = await lastHeartbeatOf(asked.workflowId, 100);
    nestedAnswers.resolve();
    await harness.temporal.workflow.getHandle(asked.workflowId).result();

    expect(outcome).toBe('settled');
    expect(heartbeat).toHaveProperty('seconds');
    expect(settledWhileAsking).toStrictEqual(['0199a3c4-7d2e-7c1a-9b3f-666666666662']);
  }, 60_000);
});
