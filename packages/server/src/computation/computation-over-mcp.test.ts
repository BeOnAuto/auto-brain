import {
  internalTermsIn,
  listedTools,
  plainTextIn,
  problemIn,
  withMcpSession,
  type McpSession,
} from '@beonauto/api/testing';
import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const computationTestTimeoutMs = 30_000;

const twice = ['---', 'language: jq', '---', '.[]'].join('\n');

const total = ['---', 'language: jq', '---', '{ total_spend_cents: (.rows | map(.cost_cents) | add) }'].join('\n');

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingReasoning([]);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

describe('a computation function over MCP, on the endpoint of its brain', { timeout: computationTestTimeoutMs }, () => {
  it('is created, run and read back with its run and the words of its result', async () => {
    const { created, executed, execution, summed } = await onAlpha(async (session) => {
      const creating = await session.callTool('create_spec', {
        primitive: 'computation',
        name: 'pace',
        source: campaignPace,
      });
      const executing = await session.callTool('execute_spec', {
        primitive: 'computation',
        name: 'pace',
        input: campaignRows(4),
      });
      const reading = await session.callTool('get_execution', {
        execution_id: String(executing.structuredContent?.['execution_id']),
      });
      await session.callTool('create_spec', { primitive: 'computation', name: 'total', source: total });
      const summing = await session.callTool('execute_spec', {
        primitive: 'computation',
        name: 'total',
        input: campaignRows(4),
      });
      return { created: creating, executed: executing, execution: reading, summed: summing };
    });

    expect(created.structuredContent).toMatchObject({ primitive: 'computation', name: 'pace', version: 1 });
    expect(executed.structuredContent).toMatchObject({ status: 'succeeded', output: { total_spend_cents: 4222 } });
    expect(plainTextIn(executed)).toBe(
      'Ran the computation function “pace”. Its result is too long to repeat here; the whole of it is in the details below.',
    );
    expect(plainTextIn(summed)).toBe('Ran the computation function “total”. Its result: total spend cents: 4222.');
    expect(execution.structuredContent).toMatchObject({ record: { language: 'jq' } });
  });
});

describe('a computation function that cannot work as written, over MCP', { timeout: computationTestTimeoutMs }, () => {
  it('answers a program that gives two outputs with isError, the conflict and its kind, in plain words', async () => {
    const executed = await onAlpha(async (session) => {
      await session.callTool('create_spec', { primitive: 'computation', name: 'twice', source: twice });
      return session.callTool('execute_spec', { primitive: 'computation', name: 'twice', input: [1, 2] });
    });

    expect({ isError: executed.isError, problem: problemIn(executed) }).toMatchObject({
      isError: true,
      problem: {
        status: 409,
        reason: 'conflict',
        kind: 'unworkable',
        detail: 'The program gave more than one output; a computation function gives exactly one',
      },
    });
    expect(plainTextIn(executed)).toContain('it cannot work as it is written');
    expect(internalTermsIn(plainTextIn(executed))).toEqual([]);
  });
});

describe('the spec tools an agent sees', { timeout: computationTestTimeoutMs }, () => {
  it('describe how a computation function is written, with the language it is written in', async () => {
    const tools = listedTools(await onAlpha((session) => session.listTools()));
    const createSpec = tools.find(({ name }) => name === 'create_spec');

    expect(createSpec?.description).toContain(
      '- `computation` (Computation), whose definition documents are text/markdown',
    );
    expect(createSpec?.description).toContain(
      'A computation function definition is YAML front matter between --- lines, then a program in jq',
    );
  });
});
