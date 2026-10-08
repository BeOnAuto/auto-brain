import { chatDelivery } from '@beonauto/interaction/testing';
import { describe, expect, it } from 'vitest';

import { chatEnvironment, chatKey, chatServer, deliveryHistoryOf } from '../testing/servers/chat-deliveries.ts';
import { servingInteractions } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/servers/workflow-calls.ts';
import { executionIdIn, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

function endedFacts(server: Awaited<ReturnType<typeof servingInteractions>>, runId: string) {
  return until(
    () => deliveryHistoryOf(server, runId),
    (facts) => facts.some(({ type }) => type === 'delivery_ended'),
  );
}

describe('an interaction function that delivers through a tool, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('posts its request with one recorded call, its sizes and digests kept, and its content where it is recorded', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');

    const facts = await endedFacts(server, runId);
    const listed = await server.call('GET', `${alpha}/interactions`);

    expect(chat.chat.posted()).toMatchObject([
      { channel: '#approvals-ada', text: 'Please review the brief for Spring.' },
    ]);
    expect(facts).toEqual([
      {
        type: 'delivery_started',
        execution_id: runId,
        by: 'brain:alpha',
        number: 1,
        delivery: { server: 'chat', tool: 'post_message' },
        target: 'ada',
        arguments_bytes: 73,
        arguments_sha256: aDigest,
      },
      {
        type: 'delivery_ended',
        execution_id: runId,
        by: 'brain:alpha',
        number: 1,
        outcome: 'delivered',
        result_bytes: aNumber,
        result_sha256: aDigest,
        jsonrpc_id: aNumber,
        duration_ms: aNumber,
        delivered_as: { conversation: '#approvals-ada', id: '1699.000001' },
      },
    ]);
    expect(listed.body).toMatchObject({
      interactions: [
        { execution_id: runId, delivery: { server: 'chat', tool: 'post_message' }, standing: 'delivered' },
      ],
    });
  });
});

describe(
  'a request delivered through a tool, as the history of its run keeps it',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('records the arguments and the answer, scrubbed, where the server records its content, shown at 2 KiB', async () => {
      const chat = await chatServer();
      const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url, { record_content: true }));
      const started = await server.call('POST', `${alpha}/specs/interaction/approve-brief/execute`, {
        body: { input: { owner: 'ada', campaign: `${chatKey} ${'x'.repeat(5000)}` } },
      });

      const [start, end] = await endedFacts(server, executionIdIn(started.body));

      expect(String(start?.['arguments_json'])).toMatch(
        /^\{"channel":"#approvals-ada","text":"Please review the brief for \[redacted\] x+$/u,
      );
      expect(String(start?.['arguments_json']).length).toBeLessThanOrEqual(2048);
      expect(end?.['result_json']).toMatch(/^\{"content":\[\{"type":"text","text":"\{\\"ok\\":true/u);
    });

    it('succeeds a notification once delivered, its ending caused by the end of the delivery', async () => {
      const chat = await chatServer();
      const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
      const runId = await server.ask('brief-out');

      expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: {} });
      expect(await server.causes(runId)).toEqual([
        ['execution_started', null],
        ['interaction_requested', 'execution_started'],
        ['delivery_started', 'interaction_requested'],
        ['delivery_ended', 'delivery_started'],
        ['execution_succeeded', 'delivery_ended'],
      ]);
    });
  },
);
