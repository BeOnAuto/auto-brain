import { setTimeout } from 'node:timers/promises';

import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { recordingCallJournal, reportingAccess, serveFakeMcp, toolRun, type FakeMcpServer } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer) {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  return access;
}

async function noSessionOpen(fake: FakeMcpServer, waited = 0): Promise<number> {
  if (fake.openSessions() === 0 || waited >= 5000) {
    return fake.openSessions();
  }
  await setTimeout(10);
  return noSessionOpen(fake, waited + 10);
}

async function initializing(fake: FakeMcpServer): Promise<void> {
  if (fake.seen().some(({ rpc }) => rpc === 'initialize')) {
    return;
  }
  await setTimeout(1);
  await initializing(fake);
}

async function interruptedOpening(fake: FakeMcpServer, interrupting: () => Promise<void>): Promise<number> {
  const access = accessTo(fake);
  const opening = Effect.runFork(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }]));
  await interrupting();
  await Effect.runPromise(Fiber.interrupt(opening));
  return noSessionOpen(fake);
}

describe('a run interrupted while it opens its tools', () => {
  it.each([0, 1, 2, 3, 4])('lets its session go once the opening settles, interrupted %d ms in', async (afterMs) => {
    const fake = await fakeServer();

    expect(await interruptedOpening(fake, () => setTimeout(afterMs))).toBe(0);
  });

  it('ends the session its server was opening when it was interrupted, which no run holds any more', async () => {
    const fake = await fakeServer();

    expect(await interruptedOpening(fake, () => initializing(fake))).toBe(0);
    expect(fake.endedSessions()).toBe(1);
  });
});
