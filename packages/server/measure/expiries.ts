import { loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { brain, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';

const timers = { count: 20, seconds: 30, spacingMs: 3000 };

const dueAfterRestartMs = 40_000;

const approval = [
  '---',
  'channel: inbox',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

const pause = `document: { dsl: '1.0.3', namespace: measure, name: pause, version: '1.0.0' }
do:
  - pause: { wait: { seconds: ${timers.seconds} } }
  - done: { set: { done: true } }
`;

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ execution_id: Schema.String }));

const decodeEnded = Schema.decodeUnknownSync(Schema.Struct({ started_at: Schema.String, finished_at: Schema.String }));

const decodePage = Schema.decodeUnknownSync(
  Schema.Struct({
    executions: Schema.Array(Schema.Struct({ status: Schema.String, finished_at: Schema.optionalKey(Schema.String) })),
    next_cursor: Schema.NullOr(Schema.String),
  }),
);

type Write = (line: string) => void;

function loadNow(): string {
  return loadavg()
    .map((average) => average.toFixed(1))
    .join(', ');
}

function spread(sorted: readonly number[]): string {
  return `${percentile(sorted, 0)} ms at least, ${percentile(sorted, 0.5)} ms at the median, ${percentile(sorted, 0.95)} ms at p95 and ${percentile(sorted, 1)} ms at most`;
}

async function askedOn(server: MeasuredServer, requests: number): Promise<number> {
  await server.call('POST', '/v1/orgs/local/brains', { brain: 'measure', name: 'Measure' });
  await server.call('POST', `${brain}/specs/interaction`, { name: 'approval', source: approval });
  await server.call('POST', `${brain}/specs/orchestration`, { name: 'pause', source: pause });
  const from = Date.now();
  await inTurns(requests, 32, async (index) => {
    decodeStarted(
      await server.call('POST', `${brain}/specs/interaction/approval/execute`, {
        input: { owner: `owner-${index % 100}` },
      }),
    );
  });
  return Date.now() - from;
}

async function timersStarted(server: MeasuredServer, dueAt: number, index = 0): Promise<readonly string[]> {
  if (index === timers.count) {
    return [];
  }
  await sleep(Math.max(0, dueAt - timers.seconds * 1000 + index * timers.spacingMs - Date.now()));
  const started = decodeStarted(await server.call('POST', `${brain}/specs/orchestration/pause/execute`, { input: {} }));
  return [started.execution_id, ...(await timersStarted(server, dueAt, index + 1))];
}

async function latenessOf(server: MeasuredServer, runs: readonly string[]): Promise<readonly number[]> {
  const ended = await Promise.all(
    runs.map(async (run) => decodeEnded(await server.call('GET', `${brain}/executions/${run}`))),
  );
  return ended.map(
    ({ started_at: startedAt, finished_at: finishedAt }) =>
      Date.parse(finishedAt) - Date.parse(startedAt) - timers.seconds * 1000,
  );
}

async function expiryLagsOf(
  server: MeasuredServer,
  dueAt: number,
  cursor: string | null = null,
): Promise<readonly number[]> {
  const after = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
  const page = decodePage(await server.call('GET', `${brain}/executions?primitive=interaction&limit=100${after}`));
  const lags = page.executions.flatMap(({ status, finished_at: finishedAt }) =>
    status === 'rejected' && finishedAt !== undefined ? [Date.parse(finishedAt) - dueAt] : [],
  );
  return page.next_cursor === null ? lags : [...lags, ...(await expiryLagsOf(server, dueAt, page.next_cursor))];
}

function sampledLoads(): { readonly loads: string[]; readonly stop: () => void } {
  const loads: string[] = [];
  const sampler = setInterval(() => {
    loads.push(loadNow());
  }, 10_000);
  return {
    loads,
    stop: () => {
      clearInterval(sampler);
    },
  };
}

async function measuredAfterRestart(server: MeasuredServer, dueAt: number, requests: number) {
  const sampling = sampledLoads();
  const runs = await timersStarted(server, dueAt);
  await sleep(dueAt + timers.count * timers.spacingMs + 5000 - Date.now());
  sampling.stop();
  const late = await latenessOf(server, runs);
  const lags = requests === 0 ? [] : await expiryLagsOf(server, dueAt);
  return { late, lags: lags.toSorted((a, b) => a - b), loads: sampling.loads };
}

export async function expiriesOn({ store, aLedger }: MeasuredLedger, requests: number, write: Write): Promise<void> {
  const ledger = await aLedger();
  const first = await measuredServer(ledger.environment);
  const askedMs = await askedOn(first, requests);
  await first.stop();
  const dueAt = Date.now() + dueAfterRestartMs;
  const moved = requests === 0 ? 0 : await ledger.expireEveryRequestAt(dueAt);
  const second = await measuredServer(ledger.environment);
  try {
    const { late, lags, loads } = await measuredAfterRestart(second, dueAt, requests);
    const sortedLate = late.toSorted((a, b) => a - b);
    const rate = lags.length === 0 ? 0 : Math.round((lags.length * 1000) / Math.max(1, percentile(lags, 1)));
    write(
      requests === 0
        ? `${store}, with no request due:`
        : `${store}: ${requests} requests asked in ${askedMs} ms; ${moved} moved to expire at one moment after a restart; ${lags.length} settled unanswered as expired, after that moment by ${spread(lags)}, ${rate} a second`,
    );
    write(
      `${store}: ${late.length} workflow timers due from that moment, one every ${timers.spacingMs} ms, late by ${spread(sortedLate)}; in the order they were due, ${late.join(', ')} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    await second.stop();
  }
}
