import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';
import { setTimeout } from 'node:timers/promises';

import { withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle.ts';
import {
  developmentFiles,
  developmentTestTimeoutMs,
  localTemporalPorts,
  startDevelopment,
  untilListening,
} from '../testing/development-process.ts';

const brain = 'support';

const charged = 'I was charged twice for March and nobody has answered for three days.';

const question = 'How do I export my invoices as CSV?';

function classifyingPrompt(rules: string): string {
  return [
    '---',
    'model: stub/classifier',
    'description: Classifies a support ticket',
    'input:',
    '  schema: {type: object, properties: {ticket: {type: string}}, required: [ticket]}',
    'output:',
    '  format: json',
    '  schema:',
    '    type: object',
    '    properties:',
    '      category: {type: string, enum: [billing, bug, account, other]}',
    '      urgency: {type: string, enum: [low, normal, high]}',
    '    required: [category, urgency]',
    '    additionalProperties: false',
    '---',
    `{% system %}You triage support tickets. ${rules}{% endsystem %}`,
    'Ticket: {{ input.ticket }}',
  ].join('\n');
}

const escalationNote = [
  '---',
  'model: stub/writer',
  'description: Drafts an escalation note for the on-call lead',
  '---',
  'Write two sentences for the on-call lead about this {{ input.category }} ticket: {{ input.ticket }}',
].join('\n');

const triage = [
  "document: {dsl: '1.0.3', namespace: support, name: triage-ticket, version: '1.0.0'}",
  'do:',
  '  - classify:',
  '      call: execute_spec',
  "      with: {primitive: inference, name: classify-ticket, input: {ticket: '${ .ticket }'}}",
  "      output: {as: '${ $input + {triage: .} }'}",
  '  - escalate:',
  '      if: .triage.urgency == "high"',
  '      call: execute_spec',
  '      with:',
  '        primitive: inference',
  '        name: escalation-note',
  "        input: {ticket: '${ .ticket }', category: '${ .triage.category }'}",
  "      output: {as: '${ $input + {note: .} }'}",
].join('\n');

const approval = [
  "document: {dsl: '1.0.3', namespace: support, name: refund-approval, version: '1.0.0'}",
  'do:',
  '  - wait-for-manager:',
  '      listen: {to: {one: {with: {type: com.acme.refund.approved}}}}',
  "      output: {as: '${ {refund: $workflow.input.refund, approved_by: .[0].by} }'}",
].join('\n');

const escalationAnswer =
  'A customer was charged twice for March and has waited three days. Please refund and reply today.';

function answerTo(request: string): string {
  if (request.includes('on-call lead')) {
    return escalationAnswer;
  }
  const money = request.includes('charged');
  return JSON.stringify({ category: money ? 'billing' : 'other', urgency: money ? 'high' : 'low' });
}

async function answered(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const content = answerTo(await text(request));
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 1_790_000_000,
      model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 64, completion_tokens: 16, total_tokens: 80 },
    }),
  );
}

async function stubGateway(): Promise<string> {
  const server = createServer((request, response) => {
    void answered(request, response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
  return JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]);
}

async function onPnpmDev<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  const development = startDevelopment(developmentFiles(), {
    temporal: await localTemporalPorts(),
    environment: { MODEL_GATEWAYS: await stubGateway() },
  });
  const port = await untilListening(development);
  return withMcpSession('current revision', { url: `http://localhost:${port}/mcp`, headers: {} }, use);
}

function structured(result: ToolResult): Readonly<Record<string, unknown>> {
  return { isError: result.isError ?? false, ...result.structuredContent };
}

async function settled(session: McpSession, executionId: unknown): Promise<Readonly<Record<string, unknown>>> {
  const reading = structured(await session.callTool('get_execution', { brain, execution_id: executionId }));
  if (reading['status'] !== 'started') {
    return reading;
  }
  await setTimeout(100);
  return settled(session, executionId);
}

async function stored(session: McpSession, primitive: string, name: string, source: string): Promise<unknown> {
  return structured(await session.callTool('create_spec', { brain, primitive, name, source }));
}

async function executed(session: McpSession, name: string, input: object, primitive = 'inference'): Promise<unknown> {
  const started = structured(await session.callTool('execute_spec', { brain, primitive, name, input }));
  return settled(session, started['execution_id']);
}

describe(
  'the requests the quick start suggests, made over /mcp as an assistant would',
  {
    timeout: developmentTestTimeoutMs,
  },
  () => {
    it('creates a brain, stores a classifying prompt, runs it, reads its record and runs a new version', async () => {
      const steps = await onPnpmDev(async (session) => ({
        brain: structured(await session.callTool('create_brain', { brain, name: 'Support' })),
        stored: await stored(session, 'inference', 'classify-ticket', classifyingPrompt('Answer as JSON.')),
        first: await executed(session, 'classify-ticket', { ticket: charged }),
        updated: structured(
          await session.callTool('update_spec', {
            brain,
            primitive: 'inference',
            name: 'classify-ticket',
            source: classifyingPrompt('Anything about money is billing and at least normal urgency.'),
          }),
        ),
        second: await executed(session, 'classify-ticket', { ticket: charged }),
      }));

      expect(steps).toMatchObject({
        brain: { isError: false, id: brain, status: 'active' },
        stored: { isError: false, name: 'classify-ticket', version: 1 },
        first: {
          status: 'succeeded',
          output: { category: 'billing', urgency: 'high' },
          record: { usage: { total: 80 }, prompt: { message: `\nTicket: ${charged}` } },
        },
        updated: { isError: false, version: 2 },
        second: { status: 'succeeded', name: 'classify-ticket', spec_version: 2 },
      });
    });
  },
);

describe('the workflow requests of the quick start, over /mcp', { timeout: developmentTestTimeoutMs }, () => {
  it('builds a workflow that drafts an escalation note only for an urgent ticket, and runs it on two', async () => {
    const outputs = await onPnpmDev(async (session) => {
      await session.callTool('create_brain', { brain, name: 'Support' });
      await stored(session, 'inference', 'classify-ticket', classifyingPrompt('Answer as JSON.'));
      await stored(session, 'inference', 'escalation-note', escalationNote);
      await stored(session, 'orchestration', 'triage-ticket', triage);
      return [
        await executed(session, 'triage-ticket', { ticket: charged }, 'orchestration'),
        await executed(session, 'triage-ticket', { ticket: question }, 'orchestration'),
      ];
    });

    expect(outputs).toMatchObject([
      { status: 'succeeded', output: { triage: { urgency: 'high' }, note: escalationAnswer } },
      { status: 'succeeded', output: { ticket: question, triage: { category: 'other', urgency: 'low' } } },
    ]);
  });

  it('starts a workflow that waits for an approval, sends the approval, and sees it finish', async () => {
    const ending = await onPnpmDev(async (session) => {
      await session.callTool('create_brain', { brain, name: 'Support' });
      await stored(session, 'orchestration', 'refund-approval', approval);
      const started = structured(
        await session.callTool('execute_spec', {
          brain,
          primitive: 'orchestration',
          name: 'refund-approval',
          input: { refund: 'ticket-4711' },
        }),
      );
      const sent = structured(
        await session.callTool('send_execution_event', {
          brain,
          execution_id: started['execution_id'],
          event: { type: 'com.acme.refund.approved', data: { by: 'dana' } },
        }),
      );
      return { started, sent, settled: await settled(session, started['execution_id']) };
    });

    expect(ending).toMatchObject({
      started: { status: 'started' },
      sent: { isError: false },
      settled: { status: 'succeeded', output: { refund: 'ticket-4711', approved_by: 'dana' } },
    });
  });
});
