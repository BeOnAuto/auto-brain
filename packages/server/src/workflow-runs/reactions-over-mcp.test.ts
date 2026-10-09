import { setTimeout } from 'node:timers/promises';

import { withMcpSession, type McpSession } from '@beonauto/api/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const closing = workflowSource(
  'close-the-month',
  "schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { month: '${ .[0].data.month }' } }\n",
);

const ListedRuns = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ status: Schema.String, started_by: Schema.String })),
});

const BrainEvents = Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const eventsIn = Schema.decodeUnknownSync(BrainEvents);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingWorkflows([]);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

async function endedRuns(session: McpSession, attempts = 300): Promise<typeof ListedRuns.Type> {
  const listed = runsIn(
    (await session.callTool('list_runs', { type: 'workflow', name: 'close-the-month' })).structuredContent,
  );
  if (listed.runs.some(({ status }) => status !== 'started') || attempts <= 1) {
    return listed;
  }
  await setTimeout(100);
  return endedRuns(session, attempts - 1);
}

describe('a workflow whose trigger is an event, over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('runs as the brain for an event published to the brain, and the feed shows the event and the run', async () => {
    const seen = await onAlpha(async (session) => {
      await session.callTool('create_definition', { type: 'workflow', name: 'close-the-month', source: closing });
      await session.callTool('publish_event', {
        event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } },
      });
      const runs = await endedRuns(session);
      const feed = await session.callTool('list_brain_events', { order: 'asc' });
      return { runs, feed: eventsIn(feed.structuredContent).events.map(({ type }) => type) };
    });

    expect(seen.runs.runs).toEqual([{ status: 'succeeded', started_by: 'brain:alpha' }]);
    expect(seen.feed).toEqual(expect.arrayContaining(['event_published', 'run_started', 'run_succeeded']));
  });
});
