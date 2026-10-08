import { deliveryIdKey } from '@beonauto/mcp/policy';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { brain, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';
import { executionIdOf, pauseSource, spread, timersMeasured, type TimerPlan } from './timer-runs.ts';

const toolKey = 'measure-tool-key-6d02b8f1';

const approval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'deliver:',
  '  server: hanging',
  '  tool: sleep',
  '  with:',
  '    ms: 3600000',
  "    text: '{{ message }}'",
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

type Write = (line: string) => void;

const decodeMeta = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

interface OpenSessions {
  readonly most: () => number;
  readonly stop: () => void;
}

function sampledOpenSessions(tool: FakeMcpServer): OpenSessions {
  const counts = { most: 0 };
  const sampling = setInterval(() => {
    counts.most = Math.max(counts.most, tool.openSessions());
  }, 100);
  return {
    most: () => counts.most,
    stop: () => {
      clearInterval(sampling);
    },
  };
}

function hangingServerOf(url: string): Readonly<Record<string, string>> {
  return {
    HANGING_KEY: toolKey,
    MCP_SERVERS: JSON.stringify({
      hanging: { url, headers: { Authorization: 'Bearer ${HANGING_KEY}' }, org: 'local' },
    }),
  };
}

async function askedOn(server: MeasuredServer, requests: number, plan: TimerPlan): Promise<number> {
  await server.call('POST', '/v1/orgs/local/brains', { brain: 'measure', name: 'Measure' });
  await server.call('POST', `${brain}/specs/interaction`, { name: 'approval', source: approval });
  await server.call('POST', `${brain}/specs/orchestration`, { name: 'pause', source: pauseSource(plan.seconds) });
  const from = Date.now();
  await inTurns(requests, 32, async (index) => {
    executionIdOf(
      await server.call('POST', `${brain}/specs/interaction/approval/execute`, { input: { owner: `owner-${index}` } }),
    );
  });
  return Date.now() - from;
}

function attemptsOf(tool: FakeMcpServer) {
  const received = tool.received();
  const requests = new Set(received.map(({ meta }) => String(decodeMeta(meta)[deliveryIdKey])));
  return { attempts: received.length, requests: requests.size };
}

export async function hangingOn({ store, aLedger }: MeasuredLedger, requests: number, write: Write): Promise<void> {
  const tool = await serveFakeMcp({ bearer: toolKey });
  const ledger = await aLedger();
  const server = await measuredServer({ ...ledger.environment, ...hangingServerOf(tool.url) });
  const open = sampledOpenSessions(tool);
  try {
    const plan: TimerPlan = { firstDueAt: Date.now() + 6000, count: 20, spacingMs: 3000, seconds: 5 };
    const askedAt = Date.now();
    const askedMs = await askedOn(server, requests, plan);
    const { late, loads } = await timersMeasured(server, plan);
    const watchedMs = Date.now() - askedAt;
    const sorted = late.toSorted((a, b) => a - b);
    const { attempts, requests: tried } = attemptsOf(tool);
    write(
      `${store}: ${requests} requests through a tool that never answers, asked in ${askedMs} ms; in the ${Math.round(watchedMs / 1000)} s from the first ask it took ${attempts} attempts of ${tried} requests, ${attempts - tried} of them a second attempt of a request whose first timed out, ${open.most()} open at once at most`,
    );
    write(
      `${store}: ${late.length} workflow timers due meanwhile, one every ${plan.spacingMs} ms, late by ${spread(sorted)}; in the order they were due, ${late.join(', ')} ms; p50 ${percentile(sorted, 0.5)} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    open.stop();
    await server.stop();
    await tool.close();
  }
}
