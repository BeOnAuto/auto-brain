import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { startScheduler, wallClock } from './scheduler.ts';
import { freshFile, seedTimers, seeded, summarize } from './timer-plan.ts';
import { openTimerStore } from './timer-store.ts';

const count = 300;
const spanMs = 60_000;

function busyFor(milliseconds: number): void {
  const until = wallClock() + milliseconds;
  while (wallClock() < until) {
    Math.sqrt(until);
  }
}

async function trial(loaded: boolean): Promise<object> {
  const fileName = freshFile(`precision-${loaded ? 'loaded' : 'idle'}`);
  const from = wallClock() + 1_000;
  const plan = seedTimers(fileName, count, from, spanMs);
  const store = openTimerStore(fileName);
  const scheduler = startScheduler({
    store,
    by: 'p1',
    mode: 'claim-then-fire',
    fire: (timer, lateMs) => {
      store.recordEffect(timer.id, wallClock(), 'p1', lateMs);
    },
  });
  const random = seeded(7);
  const toCancel = plan.ids.filter(() => random() < 0.1);
  const due = new Map(
    store.database
      .prepare('SELECT id, fire_at FROM timers')
      .all()
      .map((row) => [String(row['id']), Number(row['fire_at'])]),
  );
  const cancelled = new Set<string>();
  for (const id of toCancel) {
    const fireAt = due.get(id) ?? from;
    setTimeout(
      () => {
        scheduler.cancel(id);
        cancelled.add(id);
      },
      Math.max(0, (fireAt - wallClock()) / 2),
    );
  }
  const load = loaded
    ? setInterval(() => {
        busyFor(25);
      }, 100)
    : undefined;
  await sleep(spanMs + 3_000);
  clearInterval(load);
  scheduler.stop();
  const stats = scheduler.stats();
  store.close();
  return {
    variant: loaded ? 'event loop busy 25 ms in every 100 ms' : 'idle event loop',
    timers: count,
    spreadOverMs: spanMs,
    cancelledWhileArmed: cancelled.size,
    ...summarize(fileName, { ids: plan.ids, cancelled }),
    wakes: stats.wakes,
  };
}

const report = [await trial(false), await trial(true)];
console.log(JSON.stringify(report, null, 2));
writeFileSync(
  join(import.meta.dirname, '..', 'results', 'timers-precision.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
