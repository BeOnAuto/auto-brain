import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openTimerStore } from './timer-store.ts';

export const dataDirectory = join(import.meta.dirname, '..', '.data');

export function freshFile(name: string): string {
  const directory = join(dataDirectory, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return join(directory, 'timers.db');
}

export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export interface Plan {
  readonly ids: readonly string[];
  readonly cancelled: ReadonlySet<string>;
}

export function seedTimers(fileName: string, count: number, from: number, spanMs: number, cancelShare = 0): Plan {
  const random = seeded(42);
  const store = openTimerStore(fileName);
  const ids: string[] = [];
  const cancelled = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const id = `t-${String(index).padStart(4, '0')}`;
    store.arm({
      id,
      runId: `run-${index % 30}`,
      fireAt: Math.round(from + random() * spanMs),
      summary: `timer ${index}`,
    });
    ids.push(id);
    if (random() < cancelShare) {
      store.cancel(id);
      cancelled.add(id);
    }
  }
  store.close();
  return { ids, cancelled };
}

export interface EffectSummary {
  readonly fired: number;
  readonly firedTwiceOrMore: number;
  readonly missing: number;
  readonly cancelledButFired: number;
  readonly lateMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
  readonly byProcess: Readonly<Record<string, number>>;
}

function percentile(sorted: readonly number[], share: number): number {
  return +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN).toFixed(2);
}

export function summarize(fileName: string, plan: Plan, select = (_id: string) => true): EffectSummary {
  const database = new DatabaseSync(fileName);
  const rows = database.prepare('SELECT timer_id, fired_by, late_ms FROM timer_effects').all();
  database.close();
  const counts = new Map<string, number>();
  const byProcess: Record<string, number> = {};
  const late: number[] = [];
  for (const row of rows) {
    const id = String(row['timer_id']);
    if (!select(id)) {
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const by = String(row['fired_by']);
    byProcess[by] = (byProcess[by] ?? 0) + 1;
    late.push(Number(row['late_ms']));
  }
  const expected = plan.ids.filter((id) => !plan.cancelled.has(id) && select(id));
  const sorted = late.toSorted((left, right) => left - right);
  return {
    fired: counts.size,
    firedTwiceOrMore: [...counts.values()].filter((count) => count > 1).length,
    missing: expected.filter((id) => !counts.has(id)).length,
    cancelledButFired: [...plan.cancelled].filter((id) => counts.has(id)).length,
    lateMs: {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: percentile(sorted, 1),
    },
    byProcess,
  };
}
