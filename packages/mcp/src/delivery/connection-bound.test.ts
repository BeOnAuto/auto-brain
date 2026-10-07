import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import type { McpConnection } from '../connections/mcp-connection.ts';
import { connectionBoundOf, takenWithin } from './connection-bound.ts';
import { deliveryBounds } from './delivery-bounds.ts';

const connection: McpConnection = {
  call: () => Promise.reject(new Error('No call is made')),
  listTools: () => Promise.resolve([]),
  closed: Promise.withResolvers<void>().promise,
  end: () => Promise.resolve(),
};

const anyMessage: unknown = expect.any(String);

interface Opening {
  readonly take: () => Promise<McpConnection>;
  readonly release: () => Promise<void>;
  readonly released: () => number;
}

function opening(take: () => Promise<McpConnection>): Opening {
  const counts = { released: 0 };
  return {
    take,
    release: () => {
      counts.released += 1;
      return Promise.resolve();
    },
    released: () => counts.released,
  };
}

describe('the opening of a connection for a delivery', () => {
  it('waits as long as the shared opening may, but never longer than a delivery may', () => {
    expect([
      connectionBoundOf(defaultTiming),
      connectionBoundOf({ openMs: 60_000 }),
      connectionBoundOf({ openMs: 250 }),
    ]).toEqual([deliveryBounds.connectionMs, deliveryBounds.connectionMs, 250]);
  });

  it('takes a connection that opens in time, and the failure of one that cannot open', async () => {
    const quick = opening(() => Promise.resolve(connection));
    const failing = opening(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')));

    expect(await takenWithin(quick, 1000)).toEqual({ connection });
    expect(await takenWithin(failing, 1000)).toMatchObject({ failure: { message: anyMessage } });
    expect([quick.released(), failing.released()]).toEqual([0, 0]);
  });

  it('gives up at its bound, and lets go of a connection that opens after it, never of one that fails', async () => {
    const slow = opening(async () => {
      await sleep(60);
      return connection;
    });
    const slowFailing = opening(async () => {
      await sleep(60);
      throw new Error('The server went away');
    });

    const taken = await Promise.all([takenWithin(slow, 10), takenWithin(slowFailing, 10)]);
    await sleep(120);

    expect(taken).toEqual([{ late: true }, { late: true }]);
    expect([slow.released(), slowFailing.released()]).toEqual([1, 0]);
  });
});
