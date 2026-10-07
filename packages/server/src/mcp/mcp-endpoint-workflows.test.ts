import { setTimeout } from 'node:timers/promises';

import { toolNamesIn, withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/inference/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const greeting = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Greet {{ input.name }}.'].join('\n');

const welcome = workflowSource(
  'welcome',
  `do:
  - greet:
      call: execute_spec
      with: { primitive: inference, name: greeting, input: { name: '\${ .name }' } }
      output:
        as: '\${ { greeting: . } }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '\${ $input + { reply: .[0] } }'
`,
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

async function settled(session: McpSession, executionId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_execution', { brain: 'sales', execution_id: executionId });
  if (reading.structuredContent?.['status'] !== 'started') {
    return reading;
  }
  await setTimeout(100);
  return settled(session, executionId);
}

async function welcomedAfterReply(session: McpSession): Promise<ToolResult> {
  await session.callTool('create_brain', { brain: 'sales', name: 'Sales' });
  await session.callTool('create_spec', { brain: 'sales', primitive: 'inference', name: 'greeting', source: greeting });
  await session.callTool('create_spec', {
    brain: 'sales',
    primitive: 'orchestration',
    name: 'welcome',
    source: welcome,
  });
  const started = await session.callTool('execute_spec', {
    brain: 'sales',
    primitive: 'orchestration',
    name: 'welcome',
    input: { name: 'Ada' },
  });
  const executionId = String(started.structuredContent?.['execution_id']);
  await session.callTool('send_execution_event', {
    brain: 'sales',
    execution_id: executionId,
    event: { type: 'com.acme.customer.replied', data: 'Thank you!' },
  });
  return settled(session, executionId);
}

describe('/mcp with workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('lists twenty tools, and its instructions say how a workflow gets an event', async () => {
    server = await servingWorkflows([]);

    const served = await onMcp(async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      instructions: session.instructions,
    }));

    expect(served.tools).toHaveLength(20);
    expect(served.tools.at(-1)).toBe('send_execution_event');
    expect(served.instructions).toContain('A waiting workflow run receives input through send_execution_event.');
  });

  it('runs a workflow in a brain it created and sends it the event it waits for, on one connection', async () => {
    server = await servingWorkflows([answers(textResult('Hello, Ada.'))]);

    const execution = await onMcp(welcomedAfterReply);

    expect(execution.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { greeting: 'Hello, Ada.', reply: 'Thank you!' },
    });
  });
});
