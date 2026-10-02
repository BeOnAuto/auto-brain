import { Effect, Exit, Scope } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectOrchestration } from '../primitive/orchestration-client.ts';
import { orchestratedBrain, type OrchestratedBrain } from '../testing/orchestrated-brain.ts';
import { settingsFor } from '../testing/temporal.ts';
import { defineSendExecutionEvent } from './send-execution-event.ts';

let brain: OrchestratedBrain;

let sendEvent: ReturnType<typeof defineSendExecutionEvent>;

const approval = `document:
  dsl: '1.0.3'
  namespace: acme
  name: approval
  version: '1.0.0'
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`;

beforeAll(async () => {
  brain = await orchestratedBrain('execution-events');
  sendEvent = defineSendExecutionEvent(brain.client);
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'approval', source: approval });
  await brain.call(brain.createSpec, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
}, 60_000);

afterAll(async () => {
  await brain.close();
}, 60_000);

function idOf(number: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(number).padStart(12, '4')}`;
}

async function startedApproval(executionId: string): Promise<void> {
  await brain.call(brain.executeSpec, { primitive: 'orchestration', name: 'approval', execution_id: executionId });
}

describe('send_execution_event', () => {
  it('is a brain command at POST /executions/{execution_id}/events', () => {
    expect(sendEvent.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      route: { method: 'POST', path: '/executions/{execution_id}/events' },
      reasons: ['not_found', 'unavailable'],
    });
  });

  it('delivers an event to the running workflow, which listens for it and ends', async () => {
    const executionId = idOf(1);
    await startedApproval(executionId);

    const sent = await brain.call(sendEvent, {
      execution_id: executionId.toUpperCase(),
      event: { id: 'decision-1', type: 'com.acme.approval.decided', data: { approved: true } },
    });
    await brain.temporal.workflow.getHandle(`acme/alpha/approval/${executionId}`).result();

    expect(sent).toMatchObject({
      status: 'succeeded',
      output: { execution_id: executionId, event: { id: 'decision-1', type: 'com.acme.approval.decided' } },
    });
    expect(await brain.call(brain.getExecution, { execution_id: executionId })).toMatchObject({
      output: { status: 'succeeded', output: [{ approved: true }] },
    });
  }, 60_000);

  it('gives an event an id and the time it was sent', async () => {
    const executionId = idOf(2);
    await startedApproval(executionId);

    const sent = await brain.call(sendEvent, { execution_id: executionId, event: { type: 'com.acme.other' } });

    expect(sent).toMatchObject({ status: 'succeeded', output: { event: { type: 'com.acme.other' } } });
    expect(JSON.stringify(sent)).toMatch(/"id":"[0-9a-f-]{36}","time":"\d{4}-\d{2}-\d{2}T/u);
  }, 60_000);
});

describe('send_execution_event to no running workflow', () => {
  it('is rejected as not found for an unknown execution or one of another primitive', async () => {
    const greeted = idOf(3);
    await brain.call(brain.executeSpec, { primitive: 'echo', name: 'greet', execution_id: greeted });
    const notFound = { status: 'rejected', reason: 'not_found' };

    expect(await brain.call(sendEvent, { execution_id: idOf(4), event: { type: 'x' } })).toMatchObject(notFound);
    expect(await brain.call(sendEvent, { execution_id: greeted, event: { type: 'x' } })).toMatchObject({
      ...notFound,
      detail: 'The brain has no running workflow execution with that id',
    });
  });

  it('is rejected as not found when the workflow of the execution is gone', async () => {
    const executionId = idOf(5);
    await startedApproval(executionId);
    await brain.temporal.workflow.getHandle(`acme/alpha/approval/${executionId}`).terminate('gone');

    expect(await brain.call(sendEvent, { execution_id: executionId, event: { type: 'x' } })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'The execution has no workflow running',
    });
  }, 60_000);
});

describe('send_execution_event that cannot be delivered', () => {
  it('is rejected as unavailable when Temporal cannot be reached', async () => {
    const executionId = idOf(6);
    await startedApproval(executionId);
    const scope = Effect.runSync(Scope.make());
    const unreachable = await Effect.runPromise(
      connectOrchestration({ ...settingsFor('nowhere'), address: '127.0.0.1:1' }, { requestTimeout: 500 }).pipe(
        Scope.provide(scope),
      ),
    );

    const sent = await brain.call(defineSendExecutionEvent(unreachable), {
      execution_id: executionId,
      event: { type: 'x' },
    });
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await brain.temporal.workflow.getHandle(`acme/alpha/approval/${executionId}`).terminate('done');

    expect(sent).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  }, 30_000);

  it('is rejected as invalid input when its data is larger than an event carries', async () => {
    expect(
      await brain.call(sendEvent, { execution_id: idOf(7), event: { type: 'x', data: 'x'.repeat(262_200) } }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});
