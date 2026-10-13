import { randomUUID } from 'node:crypto';

import { DatabaseFailed, type HostDatabase } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';
import { expect } from 'vitest';

import { isLive } from '../dataset-testing/dataset-predicates.ts';
import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { projectedDatasets } from '../dataset-testing/projected-datasets.ts';
import { periodOfMoment } from '../periods/moments.ts';
import { buildPlaybook, type BuildPlaybook } from './build-playbook.ts';
import { scriptedModels, type ScriptedModels } from './scripted-models.ts';

export const day = 86_400_000;

type Reading = 'live' | 'empty' | 'failing';

export interface Projected {
  readonly playbook: BuildPlaybook;
  readonly scripted: ScriptedModels;
  readonly read: (reading: Reading) => void;
}

export interface Sales {
  readonly name: string;
  readonly source: string;
  readonly type: string;
  readonly base: Readonly<Record<string, number>>;
  readonly before: number;
  readonly after: number;
  readonly valueOf: (level: number, day: number) => number | null | undefined;
  readonly deadlines?: { readonly check: number; readonly run: number; readonly walk: number };
  readonly processes?: number;
  readonly longJobs?: number;
  readonly events?: (today: number) => readonly Schema.JsonObject[];
}

function eventOf(type: string, store: string, at: number, value: number | null): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: '/stores',
    type,
    time: new Date(at + 3_600_000).toISOString(),
    data: value === null ? { store } : { store, value },
  };
}

function eventsAround(today: number, sales: Sales): readonly Schema.JsonObject[] {
  const days = Array.from({ length: sales.before + sales.after }, (_, at) => today - sales.before + at);
  return Object.keys(sales.base).flatMap((store) =>
    days.flatMap((each) => {
      const value = sales.valueOf(Number(sales.base[store]), each);
      return value === undefined ? [] : [eventOf(sales.type, store, each * day, value)];
    }),
  );
}

type Consistent = Pick<HostDatabase, 'readConsistently'>;

function databaseReading(database: Consistent, reading: () => Reading): Consistent {
  return {
    readConsistently: (reads) => {
      const current = reading();
      if (current === 'failing') {
        return Effect.fail(new DatabaseFailed({ detail: 'The database went away' }));
      }
      return current === 'empty' ? reads(() => Effect.succeed([])) : database.readConsistently(reads);
    },
  };
}

export async function projectedSales(settingsOf: SettingsOf, sales: Sales): Promise<Projected> {
  const datasets = await projectedDatasets(await settingsOf());
  const document = await datasets.saved(sales.name, sales.source);
  const today = periodOfMoment('day', Date.now());
  await datasets.published(sales.events === undefined ? eventsAround(today, sales) : sales.events(today));
  datasets.start();
  await datasets.until(document.dataSha256, isLive);
  const scripted = scriptedModels();
  const reading: { current: Reading } = { current: 'live' };
  const playbook = buildPlaybook({
    database: databaseReading(datasets.database, () => reading.current),
    module: scripted.module,
    ...(sales.deadlines === undefined ? {} : { deadlines: sales.deadlines }),
    ...(sales.processes === undefined ? {} : { processes: sales.processes, longJobs: sales.longJobs }),
  });
  expect(
    await playbook.call(playbook.operations.create, { type: 'prediction', name: sales.name, source: sales.source }),
  ).toMatchObject({ status: 'succeeded' });
  return {
    playbook,
    scripted,
    read: (current) => {
      reading.current = current;
    },
  };
}
