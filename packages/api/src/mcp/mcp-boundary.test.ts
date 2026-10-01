import { makeCatalog, makeDispatcher } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { mcpRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { problemIn, withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { testServerInfo } from '../testing/operation-server.ts';

const sdkErrors: string[] = [];

const brokenRuntime = mcpRoutes({
  catalog: makeCatalog(notebookOperations),
  dispatcher: makeDispatcher([]),
  runCall: () => Promise.reject(new Error('the runtime broke while holding database password hunter2')),
  serverInfo: testServerInfo,
  reportError: (error) => {
    sdkErrors.push(error.message);
  },
});

describe('a tool call that throws', () => {
  it('answers isError with an internal problem, and reports the error under its incident id', async () => {
    const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
    const listening = await listenOnLoopback(handler);

    const result = await withMcpSession(
      'current revision',
      { url: `${listening.origin}/orgs/acme/brains/alpha/mcp`, headers: {} },
      (session) => session.callTool('list_notes'),
    );
    await listening.close();
    const [report] = reported;

    expect({ isError: result.isError, problem: problemIn(result) }).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/internal',
        title: 'Internal error',
        status: 500,
        detail: 'An unexpected error occurred',
        reason: 'internal',
        instance: `urn:uuid:${String(report?.incident)}`,
      },
    });
    expect(report?.message).toBe('the runtime broke while holding database password hunter2');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(sdkErrors).toEqual([]);
  });
});
