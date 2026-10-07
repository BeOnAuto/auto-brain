import { internalTermsIn, listedTools, plainTextIn, withMcpSession, type McpSession } from '@beonauto/api/testing';
import { campaignReviews, recallDocument } from '@beonauto/recollection/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { anyReview, recallTestTimeoutMs, servingRecall, verdicts } from '../testing/servers/recall-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function onAlpha<T>(server: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

const counting = recallDocument(
  '. + 1',
  'language: jq\nsource:\n  events:\n    - type: execution_succeeded\nview:\n  initial: 0',
);

function liveOverMcp(session: McpSession, folded: number, name = 'reviews'): Promise<unknown> {
  return vi.waitFor(
    async () => {
      const read = await session.callTool('get_spec', { primitive: 'recollection', name });
      expect(read.structuredContent).toMatchObject({ standing: { state: 'live', folded } });
      return read.structuredContent;
    },
    { timeout: recallTestTimeoutMs - 10_000, interval: 50 },
  );
}

describe('a recall function over MCP, on the endpoint of its brain', { timeout: recallTestTimeoutMs }, () => {
  it('is saved, stands live once it has folded the runs it names, and answers from its view in plain words', async () => {
    const server = await servingRecall(verdicts({ campaign: 'spring', verdict: 'approve' }));
    closing.push(server.stop);

    const { created, spec, recalled, execution, count } = await onAlpha(server, async (session) => {
      await session.callTool('create_spec', { primitive: 'inference', name: 'review-brief', source: anyReview });
      const creating = await session.callTool('create_spec', {
        primitive: 'recollection',
        name: 'reviews',
        source: campaignReviews,
      });
      await session.callTool('create_spec', { primitive: 'recollection', name: 'count', source: counting });
      await session.callTool('execute_spec', {
        primitive: 'inference',
        name: 'review-brief',
        input: { brief: 'spring' },
      });
      const live = await liveOverMcp(session, 1);
      await liveOverMcp(session, 1, 'count');
      const counted = await session.callTool('execute_spec', { primitive: 'recollection', name: 'count', input: {} });
      const recalling = await session.callTool('execute_spec', {
        primitive: 'recollection',
        name: 'reviews',
        input: { campaign: 'spring' },
      });
      const reading = await session.callTool('get_execution', {
        execution_id: String(recalling.structuredContent?.['execution_id']),
      });
      return { created: creating, spec: live, recalled: recalling, execution: reading, count: counted };
    });

    expect(created.structuredContent).toMatchObject({ primitive: 'recollection', name: 'reviews', version: 1 });
    expect(spec).toMatchObject({ standing: { state: 'live', version: 1, folded: 1 } });
    expect(recalled.structuredContent).toMatchObject({ status: 'succeeded', output: [{ verdict: 'approve' }] });
    expect(plainTextIn(recalled)).toMatch(/^Ran the recall function “reviews”\. Its result: /u);
    expect(plainTextIn(count)).toBe('Ran the recall function “count”. Its result: 1.');
    expect(internalTermsIn(plainTextIn(count))).toEqual([]);
    expect(execution.structuredContent).toMatchObject({ record: { language: 'jq', view: { version: 1, folded: 1 } } });
  });
});

describe('the spec tools an agent sees', { timeout: recallTestTimeoutMs }, () => {
  it('describe how a recall function is written, with no tool more than before', async () => {
    const server = await servingRecall([]);
    closing.push(server.stop);

    const tools = listedTools(await onAlpha(server, (session) => session.listTools()));
    const createSpec = tools.find(({ name }) => name === 'create_spec');
    const everyTool = await withMcpSession(
      'current revision',
      { url: `${server.origin}/mcp`, headers: {} },
      (session) => session.listTools(),
    );

    expect(listedTools(everyTool)).toHaveLength(20);
    expect(createSpec?.description).toContain(
      '- `recollection` (Recall), whose definition documents are text/markdown',
    );
    expect(createSpec?.description).toContain(
      'A recall function definition is YAML front matter between --- lines, then the fold in jq',
    );
  });
});
