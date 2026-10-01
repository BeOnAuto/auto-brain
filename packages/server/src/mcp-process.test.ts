import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { connectMcp, problemIn, withMcpSession, type McpClientKind, type McpSession } from '@beonauto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shortShutdownTimeoutMs } from './testing/short-shutdown-timeout.ts';
import { spawnServer, spawnedServerTestTimeoutMs, type SpawnedServer } from './testing/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from './testing/temporary-ledger.ts';

const serveWithWaitingTool = fileURLToPath(new URL('testing/serve-with-waiting-tool.ts', import.meta.url));

const clientKinds: readonly McpClientKind[] = ['current revision', 'previous revision', 'previous major'];

const clientsClosing: ReadonlyArray<readonly [McpClientKind, string]> = [
  ['current revision', 'SdkError: Connection closed'],
  ['previous revision', 'SdkError: Connection closed'],
  ['previous major', 'McpError: MCP error -32000: Connection closed'],
];

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

interface WaitingCall {
  readonly child: SpawnedServer;
  readonly port: number;
  readonly session: McpSession;
  readonly waiting: Promise<unknown>;
}

async function waitingCallOn(kind: McpClientKind): Promise<WaitingCall> {
  const child = spawnServer(serveWithWaitingTool, {
    HOST: '127.0.0.1',
    PORT: '0',
    LOCAL_MODE: 'true',
    LEDGER_FILE: ledger.fileName,
  });
  const port = await child.port;
  await withMcpSession(kind, { url: `http://127.0.0.1:${port}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  const session = await connectMcp(kind, { url: `http://127.0.0.1:${port}/orgs/acme/brains/alpha/mcp`, headers: {} });
  const waiting = session.callTool('wait_forever', {}).then(
    (result) => ({ isError: result.isError, problem: problemIn(result) }),
    (error: unknown) => ({ ended: String(error) }),
  );
  await setTimeout(200);
  return { child, port, session, waiting };
}

describe('a server process with an MCP call in flight', { timeout: spawnedServerTestTimeoutMs }, () => {
  it.each(clientKinds)(
    'answers the %s client at the shutdown timeout with a 503 problem as isError, and exits 0',
    async (kind) => {
      const { child, session, waiting } = await waitingCallOn(kind);

      const signalled = performance.now();
      child.signal('SIGTERM');
      const answer = await waiting;
      const exitCode = await child.exited;
      await session.close();

      expect({ answer, exitCode }).toEqual({
        answer: {
          isError: true,
          problem: {
            type: 'https://on.auto/problems/unavailable',
            title: 'Unavailable',
            status: 503,
            detail: 'The server is stopping',
            reason: 'unavailable',
          },
        },
        exitCode: 0,
      });
      expect(performance.now() - signalled).toBeLessThan(shortShutdownTimeoutMs + 1500);
    },
  );

  it.each(clientsClosing)(
    'writes nothing more to stdout or stderr when the %s client disconnects in the middle of the call',
    async (kind, ended) => {
      const { child, port, session, waiting } = await waitingCallOn(kind);

      await session.close();
      const answer = await waiting;
      await setTimeout(300);
      child.signal('SIGTERM');

      expect({ answer, exitCode: await child.exited }).toEqual({ answer: { ended }, exitCode: 0 });
      expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
      expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: [^\n]*\}\n$/u);
    },
  );
});
