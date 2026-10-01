import { setTimeout } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { connectMcp } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

describe('closing the API', () => {
  it('closes what every route registered for closing', async () => {
    const closed: string[] = [];
    const closing: RegisterRoutes = (routes) => {
      routes.onClose(() => {
        closed.push('closed');
        return Promise.resolve();
      });
    };
    const { handler } = createTestHandler({ routes: [closing, closing] });

    await handler.close();

    expect(closed).toEqual(['closed', 'closed']);
  });

  it('ends a call of the current revision still running on an MCP endpoint, and reports no incident', async () => {
    const server = await operationServer();
    const listening = await listenOnLoopback(server.handler);
    const session = await connectMcp('current revision', {
      url: `${listening.origin}/orgs/acme/brains/alpha/mcp`,
      headers: { authorization: `Bearer ${acmeAdmin.key}` },
    });
    const waiting = session.callTool('wait_forever', {});
    await setTimeout(100);

    await server.handler.close();

    await expect(waiting).rejects.toThrow('Error POSTing to endpoint');
    expect(server.incidents()).toEqual([]);
    await listening.close();
    await server.runtime.dispose();
  });
});
