import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool, RunTools } from '../calls/run-tools.ts';
import { toolTests } from '../testing/index.ts';

function noEnding(): undefined {
  return undefined;
}

function runToolsOffering(offered: readonly OfferedTool[]): RunTools {
  return {
    offered,
    callsEnded: () => false,
    ended: new AbortController().signal,
    ending: noEnding,
    calledAny: () => false,
    usedInWords: () => 'no tool',
    close: () => Promise.resolve(),
  };
}

function accessOpening(tools: RunTools) {
  return { open: () => Effect.succeed(tools), testing: { allowed: null, testable: [] } };
}

const unsent: CallReply = {
  text: 'The run has ended, so this call was not sent.',
  isError: true,
  outcome: 'not_sent',
  resultBytes: null,
  durationMs: 0,
  serverRequestId: null,
};

const search: OfferedTool = {
  name: 'mcp__graph__search',
  description: 'Finds the rows of the graph that match a query.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  call: () => Promise.resolve(unsent),
};

describe('a test answered by tools that do not behave as a server’s do', () => {
  it('refuses a tool the opened tools do not offer as one its server does not list', async () => {
    const { test } = toolTests(accessOpening(runToolsOffering([])));

    expect(await test({ server: 'graph', tool: 'search' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'tool_not_listed',
    });
  });

  it('fails with an incident when the call answers that it was never sent, which a test that was sent never does', async () => {
    const { test, incidents } = toolTests(accessOpening(runToolsOffering([search])));

    expect(await test({ server: 'graph', tool: 'search' })).toMatchObject({ status: 'failed' });
    expect(String(incidents()[0]?.original)).toContain('answered not_sent');
  });
});
