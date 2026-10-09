import { setTimeout } from 'node:timers/promises';

import { toolNamesIn, withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const greeting = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Greet {{ input.name }}.'].join('\n');

const welcome = workflowSource(
  'welcome',
  `do:
  - greet:
      call: run_definition
      with: { type: reasoning, name: greeting, input: { name: '\${ $data.name }' } }
      output:
        as: '\${ ({ greeting: $data }) }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '\${ ({ ...$input, reply: $data[0] }) }'
`,
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

async function settled(session: McpSession, runId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_run', { brain: 'sales', run_id: runId });
  if (reading.structuredContent?.['status'] !== 'started') {
    return reading;
  }
  await setTimeout(100);
  return settled(session, runId);
}

async function welcomedAfterReply(session: McpSession): Promise<ToolResult> {
  await session.callTool('create_brain', { brain: 'sales', name: 'Sales' });
  await session.callTool('create_definition', {
    brain: 'sales',
    type: 'reasoning',
    name: 'greeting',
    source: greeting,
  });
  await session.callTool('create_definition', {
    brain: 'sales',
    type: 'workflow',
    name: 'welcome',
    source: welcome,
  });
  const started = await session.callTool('run_definition', {
    brain: 'sales',
    type: 'workflow',
    name: 'welcome',
    input: { name: 'Ada' },
  });
  const runId = String(started.structuredContent?.['run_id']);
  await session.callTool('send_run_event', {
    brain: 'sales',
    run_id: runId,
    event: { type: 'com.acme.customer.replied', data: 'Thank you!' },
  });
  return settled(session, runId);
}

describe('/mcp with workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('lists twenty-five tools, and its instructions say how to see whether a workflow run ended or still waits', async () => {
    server = await servingWorkflows([]);

    const served = await onMcp(async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      instructions: session.instructions,
    }));

    expect(served.tools).toHaveLength(25);
    expect(served.tools.slice(-2)).toEqual(['send_run_event', 'get_guide']);
    expect(served.instructions).toContain(
      'or a workflow answers started; get_run shows whether it ended or still waits.',
    );
  });

  it('runs a workflow in a brain it created and sends it the event it waits for, on one connection', async () => {
    server = await servingWorkflows([answers(textResult('Hello, Ada.'))]);

    const run = await onMcp(welcomedAfterReply);

    expect(run.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { greeting: 'Hello, Ada.', reply: 'Thank you!' },
    });
  });
});
