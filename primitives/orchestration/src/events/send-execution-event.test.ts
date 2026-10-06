import { mostEventDataDepth, mostInputDepth } from '@beonauto/specs';
import { mostValueDepth } from '@beonauto/workflow-engine';
import { HostElsewhere, HostStopped } from '@beonauto/workflow-host';
import { Effect, type Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { orchestratedBrain, type OrchestratedBrain } from '../testing/orchestrated-brain.ts';
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

const envelope = approval.replace('name: approval', 'name: envelope').concat('        read: envelope\n');

function nested(levels: number): Schema.Json {
  return levels === 0 ? 'yes' : [nested(levels - 1)];
}

beforeAll(async () => {
  brain = await orchestratedBrain();
  sendEvent = defineSendExecutionEvent(brain.host);
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'approval', source: approval });
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'envelope', source: envelope });
  await brain.call(brain.createSpec, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
});

afterAll(async () => {
  await brain.close();
});

const tooLong: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  ['a type', { type: 't'.repeat(257) }, '/event/type'],
  ['an id', { type: 'x', id: 'i'.repeat(257) }, '/event/id'],
  ['a source', { type: 'x', source: 's'.repeat(1025) }, '/event/source'],
  ['a subject', { type: 'x', subject: 's'.repeat(1025) }, '/event/subject'],
];

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

    expect(sent).toMatchObject({
      status: 'succeeded',
      output: { execution_id: executionId, event: { id: 'decision-1', type: 'com.acme.approval.decided' } },
    });
    expect(await brain.settled(executionId)).toMatchObject({
      output: { status: 'succeeded', output: [{ approved: true }] },
    });
  });

  it('gives an event an id and the time it was sent', async () => {
    const executionId = idOf(2);
    await startedApproval(executionId);

    const sent = await brain.call(sendEvent, { execution_id: executionId, event: { type: 'com.acme.other' } });

    expect(sent).toMatchObject({ status: 'succeeded', output: { event: { type: 'com.acme.other' } } });
    expect(JSON.stringify(sent)).toMatch(/"id":"[0-9a-f-]{36}","time":"\d{4}-\d{2}-\d{2}T/u);
  });
});

describe('send_execution_event to no running workflow', () => {
  it('is rejected as not found for an unknown execution or one of another primitive', async () => {
    const greeted = idOf(3);
    await brain.call(brain.executeSpec, { primitive: 'echo', name: 'greet', execution_id: greeted });
    const notFound = { status: 'rejected', reason: 'not_found' };

    expect(await brain.call(sendEvent, { execution_id: idOf(4), event: { type: 'x' } })).toMatchObject(notFound);
    expect(await brain.call(sendEvent, { execution_id: greeted, event: { type: 'x' } })).toMatchObject({
      ...notFound,
      detail: 'The brain has no active workflow run with that id',
    });
  });

  it.each(['not_started', 'ended'] as const)(
    'is rejected as not found when the run of the execution answers %s',
    async (answer) => {
      const executionId = idOf(5);
      const answering = defineSendExecutionEvent({ deliver: () => Effect.succeed(answer) });
      await startedApproval(executionId);

      expect(await brain.call(answering, { execution_id: executionId, event: { type: 'x' } })).toEqual({
        status: 'rejected',
        reason: 'not_found',
        detail: 'The brain has no active workflow run with that id',
      });
    },
  );
});

describe('send_execution_event that cannot be delivered', () => {
  it('is rejected as unavailable when the workflow cannot take it at that moment', async () => {
    const executionId = idOf(6);
    await startedApproval(executionId);
    const stopping = defineSendExecutionEvent({
      deliver: () => Effect.fail(new HostStopped({ detail: 'The server is stopping' })),
    });

    expect(await brain.call(stopping, { execution_id: executionId, event: { type: 'x' } })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The workflow cannot take the event now; try again shortly',
    });
  });

  it('is rejected as unavailable, saying so, when another server runs the workflows of the database', async () => {
    const executionId = idOf(19);
    await startedApproval(executionId);
    const detail = 'The workflows of this database run in another server';
    const elsewhere = defineSendExecutionEvent({ deliver: () => Effect.fail(new HostElsewhere({ detail })) });

    expect(await brain.call(elsewhere, { execution_id: executionId, event: { type: 'x' } })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail,
    });
  });

  it('is rejected as invalid input when its data is larger than an event carries', async () => {
    expect(
      await brain.call(sendEvent, { execution_id: idOf(7), event: { type: 'x', data: 'x'.repeat(262_200) } }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});

describe('an event that does not fit', () => {
  it.each(tooLong)(
    'is rejected as invalid input when %s is longer than an event carries',
    async (_, event, pointer) => {
      expect(await brain.call(sendEvent, { execution_id: idOf(8), event })).toMatchObject({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [expect.objectContaining({ pointer })],
      });
    },
  );

  it('is rejected as invalid input when the whole event takes more than 262144 bytes, each field within its bound', async () => {
    const event = {
      type: 't'.repeat(256),
      source: 's'.repeat(1024),
      subject: 's'.repeat(1024),
      data: 'd'.repeat(260_000),
    };

    expect(await brain.call(sendEvent, { execution_id: idOf(9), event })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [expect.objectContaining({ pointer: '/event' })],
    });
  });
});

describe('the data of an event', () => {
  it('may nest as deep as a workflow holds the whole event in a list, which it takes', async () => {
    const executionId = idOf(20);
    await brain.call(brain.executeSpec, { primitive: 'orchestration', name: 'envelope', execution_id: executionId });

    const sent = await brain.call(sendEvent, {
      execution_id: executionId,
      event: { type: 'com.acme.approval.decided', data: nested(510) },
    });

    expect(sent).toMatchObject({ status: 'succeeded' });
    expect(await brain.settled(executionId)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('is rejected as invalid input deeper than that, as the data of an event published to the brain', async () => {
    expect(
      await brain.call(sendEvent, { execution_id: idOf(21), event: { type: 'x', data: nested(511) } }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          detail: 'Expected data that nests at most 510 levels deep, so that the workflow can hold the event in a list',
          pointer: '/event/data',
        },
      ],
    });
    expect([mostInputDepth, mostEventDataDepth]).toEqual([mostValueDepth, mostValueDepth - 2]);
  });
});

describe('the plain language of send_execution_event', () => {
  const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

  it('says which event reached the running workflow', () => {
    const delivered = { type: 'com.acme.approval.decided', id: 'e-1', time: '2026-10-02T09:00:00.000Z' };

    expect(
      sendEvent.registration.plainLanguage?.outcome(
        { execution_id: executionId, event: delivered },
        { execution_id: executionId, event: { type: delivered.type } },
      ),
    ).toBe(
      'Delivered the event “com.acme.approval.decided” to the running workflow. The workflow uses it as soon as it is waiting for it.',
    );
  });

  it('names the event it tried to send, or what it tried', () => {
    expect([
      sendEvent.registration.plainLanguage?.attempt({ execution_id: executionId, event: { type: 'com.acme.ping' } }),
      sendEvent.registration.plainLanguage?.attempt({}),
    ]).toEqual(['send the event “com.acme.ping” to a running workflow', 'send an event to a running workflow']);
  });
});
