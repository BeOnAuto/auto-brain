import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { partnerSecret } from '@beonauto/interaction/testing';
import { serveFakeMcp } from '@beonauto/mcp/testing';
import { serveFakeReceiver, type FakeReceiver, type ReceivedRequest } from '@beonauto/outbound/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { guarded, servingInteractions } from '../testing/servers/interaction-server.ts';
import { until } from '../testing/servers/workflow-calls.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const origin = 'https://brains.example.com';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const EventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Struct({
    execution_id: Schema.String,
    to: Schema.String,
    message: Schema.String,
    answer_url: Schema.String,
    answer_token: Schema.String,
  }),
});

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(EventSchema));

function independentlySigned(posted: ReceivedRequest | undefined): string {
  const key = Buffer.from(partnerSecret.slice('whsec_'.length), 'base64');
  const signed = [posted?.headers['webhook-id'], posted?.headers['webhook-timestamp'], posted?.body].join('.');
  return `v1,${createHmac('sha256', key).update(signed, 'utf8').digest('base64')}`;
}

async function receiver(): Promise<FakeReceiver> {
  const fake = await serveFakeReceiver();
  onTestFinished(fake.close);
  return fake;
}

function partnerChannel(url: string, answers = false): Readonly<Record<string, string>> {
  return {
    CHANNELS: JSON.stringify({
      partner: { type: 'webhook', url, secret: '${PARTNER_WEBHOOK_SECRET}', to: '^[a-z]+$', answers, org: 'acme' },
    }),
    PARTNER_WEBHOOK_SECRET: partnerSecret,
    PUBLIC_ORIGIN: origin,
  };
}

function receivedAtLeast(partner: FakeReceiver, count: number): Promise<readonly ReceivedRequest[]> {
  return until(
    () => Promise.resolve(partner.received()),
    (received) => received.length >= count,
  );
}

describe('an interaction function through a webhook channel', { timeout: workflowTestTimeoutMs }, () => {
  it('posts its request signed as Standard Webhooks signs it, and takes the answer its own token gives', async () => {
    const partner = await receiver();
    const server = await servingInteractions('partner', partnerChannel(partner.url));
    const first = await server.ask('approve-brief');
    const [posted] = await receivedAtLeast(partner, 1);
    const second = await server.ask('approve-brief');
    const event = decodeEvent(posted?.body);
    const [, other] = (await receivedAtLeast(partner, 2)).map(({ body }) => decodeEvent(body));

    const refused = await server.answer(
      first,
      { answer: { choice: 'reject' } },
      `Request ${String(other?.data.answer_token)}`,
    );
    const answered = await server.answer(
      first,
      { answer: { choice: 'approve' } },
      `Request ${event.data.answer_token}`,
    );

    expect(posted?.headers['webhook-signature']).toBe(independentlySigned(posted));
    expect(event).toMatchObject({
      id: posted?.headers['webhook-id'],
      type: 'interaction_requested',
      data: {
        execution_id: first,
        to: 'ada',
        message: 'Please review the brief for Spring.',
        answer_url: `${origin}/v1/orgs/acme/brains/alpha/executions/${first}/answer`,
      },
    });
    expect([other?.data.execution_id, refused.status, answered.status]).toEqual([second, 403, 200]);
    expect(await server.settled(first)).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(await server.causes(first)).toEqual([
      ['execution_started', null],
      ['interaction_requested', 'execution_started'],
      ['delivery_started', 'interaction_requested'],
      ['delivery_ended', 'delivery_started'],
      ['execution_succeeded', 'interaction_requested'],
    ]);
  });
});

describe(
  'a webhook channel whose receiver answers within the delivery or refuses it',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('takes the answer a receiver gives within the delivery, on a channel that allows it', async () => {
      const partner = await receiver();
      partner.answerWith({ status: 200, body: JSON.stringify({ choice: 'reject', note: 'Not this quarter' }) });
      const server = await servingInteractions('partner', partnerChannel(partner.url, true));

      expect(await server.settled(await server.ask('approve-brief'))).toMatchObject({
        status: 'succeeded',
        output: { choice: 'reject', note: 'Not this quarter' },
      });
    });

    it('ends a notification its receiver refuses as unanswered, which a workflow catch names', async () => {
      const partner = await receiver();
      partner.answerEveryWith({ status: 400 });
      const server = await servingInteractions('partner', partnerChannel(partner.url));

      expect(
        await server.settled(await server.workflow('announce', guarded('brief-out', 'undelivered'))),
      ).toMatchObject({
        status: 'succeeded',
        output: { caught: 'undelivered' },
      });
      expect(partner.received()).toHaveLength(1);
    });
  },
);

describe('an interaction function through an MCP channel', { timeout: workflowTestTimeoutMs }, () => {
  it('calls the channel’s tool once, with the request rendered into its arguments', async () => {
    const graph = await serveFakeMcp({ bearer: apiKey });
    onTestFinished(graph.close);
    const server = await servingInteractions('approvals', {
      GRAPH_API_KEY: apiKey,
      MCP_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
      CHANNELS: JSON.stringify({
        approvals: {
          type: 'mcp',
          server: 'graph',
          tool: 'echo',
          to: '^[a-z]+$',
          with: { channel: '#approvals-{{ to }}', text: '{{ message }}', run: '{{ run_id }}' },
          org: 'acme',
        },
      }),
    });
    const runId = await server.ask('approve-brief');

    const [call] = await until(
      () => Promise.resolve(graph.received()),
      (received) => received.length > 0,
    );

    expect(call).toMatchObject({
      tool: 'echo',
      arguments: { channel: '#approvals-ada', text: 'Please review the brief for Spring.', run: runId },
    });
  });
});
