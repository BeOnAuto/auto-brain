import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';

import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { brain, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';
import { executionIdOf, pauseSource, spread, timersMeasured, type TimerPlan } from './timer-runs.ts';

interface HangingReceiver {
  readonly url: string;
  readonly mostOpen: () => number;
  readonly received: () => number;
  readonly requests: () => number;
  readonly close: () => Promise<void>;
}

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const partnerSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

const approval = [
  '---',
  'channel: partner',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

type Write = (line: string) => void;

async function hangingReceiver(): Promise<HangingReceiver> {
  const counts = { open: 0, mostOpen: 0, received: 0 };
  const ids = new Set<string>();
  const server = createServer((incoming: IncomingMessage) => {
    counts.open += 1;
    counts.received += 1;
    ids.add(String(incoming.headers['webhook-id']));
    counts.mostOpen = Math.max(counts.mostOpen, counts.open);
    incoming.resume();
    incoming.socket.on('close', () => {
      counts.open -= 1;
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${decodeAddress(server.address()).port}/requests`,
    mostOpen: () => counts.mostOpen,
    received: () => counts.received,
    requests: () => ids.size,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function partnerOf(url: string): Readonly<Record<string, string>> {
  return {
    CHANNELS: JSON.stringify({
      partner: { type: 'webhook', url, secret: '${PARTNER_WEBHOOK_SECRET}', to: '^[a-z0-9-]+$', org: 'local' },
    }),
    PARTNER_WEBHOOK_SECRET: partnerSecret,
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

export async function hangingOn({ store, aLedger }: MeasuredLedger, requests: number, write: Write): Promise<void> {
  const receiver = await hangingReceiver();
  const ledger = await aLedger();
  const server = await measuredServer({ ...ledger.environment, ...partnerOf(receiver.url) });
  try {
    const plan: TimerPlan = { firstDueAt: Date.now() + 6000, count: 20, spacingMs: 3000, seconds: 5 };
    const askedAt = Date.now();
    const askedMs = await askedOn(server, requests, plan);
    const { late, loads } = await timersMeasured(server, plan);
    const watchedMs = Date.now() - askedAt;
    const sorted = late.toSorted((a, b) => a - b);
    const again = receiver.received() - receiver.requests();
    write(
      `${store}: ${requests} requests to a receiver that never answers, asked in ${askedMs} ms; in the ${Math.round(watchedMs / 1000)} s from the first ask it took ${receiver.received()} attempts of ${receiver.requests()} requests, ${again} of them a second attempt of a request whose first timed out, ${receiver.mostOpen()} open at once at most`,
    );
    write(
      `${store}: ${late.length} workflow timers due meanwhile, one every ${plan.spacingMs} ms, late by ${spread(sorted)}; in the order they were due, ${late.join(', ')} ms; p50 ${percentile(sorted, 0.5)} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    await server.stop();
    await receiver.close();
  }
}
