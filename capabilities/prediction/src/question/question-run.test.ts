import { setTimeout as sleep } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, savedFunction } from '../build-testing/built-versions.ts';
import { scriptedModels, type ScriptedModels } from '../build-testing/scripted-models.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';
import type { PortOptions } from '../testing/prediction-ports.ts';
import { uploadDataset } from '../upload/upload-dataset.ts';

const heldWalk = { rows: '/held.csv', window: 3, holdout: 1, steps: 1, features: 0, given: [], remaining: null };

const someMilliseconds: unknown = expect.any(Number);

async function activeVisits(options: PortOptions = {}): Promise<BuildPlaybook> {
  const playbook = buildPlaybook(options);
  await savedFunction(playbook);
  await builtFrom(playbook, ['visits-mean']);
  return playbook;
}

type Deadlines = NonNullable<PortOptions['deadlines']>;

const ordinaryDeadlines: Deadlines = { check: 30_000, run: 10_000, walk: 60_000, baselines: 30_000 };

async function scriptedVisits(deadlines: Deadlines = ordinaryDeadlines, processes = 4) {
  const scripted: ScriptedModels = scriptedModels();
  const playbook = await activeVisits({ module: scripted.module, deadlines, processes });
  return { scripted, playbook };
}

describe('a question to a prediction function', () => {
  it('is answered by the active version for the step it asks, from the last period of its dataset', async () => {
    const playbook = await activeVisits();

    expect(await asked(playbook, { series: 'south', horizon: 2 })).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'succeeded',
        output: {
          series: 'south',
          origin: '2026-10-09',
          period: '2026-10-11',
          horizon: 2,
          value: 21,
          low: 19,
          high: 23,
          coverage: 0.8,
          version: 1,
        },
        record: { version: 1, origin: '2026-10-09', dataset_checkpoint: null, duration_ms: someMilliseconds },
      },
    });
  });

  it('is refused for a series its dataset does not hold, and once the data part changed since its version was built', async () => {
    const playbook = await activeVisits();
    const unknown = await asked(playbook, { series: 'east', horizon: 1 });
    const more = dailyRows('visits', ['east', 'north', 'south'], 40, steadyVisits);
    await playbook.send(uploadDataset(playbook.test.ports.ledger.content), { sha256: more.sha256 }, more.text);
    await playbook.call(playbook.operations.update, {
      type: 'prediction',
      name: 'daily-visits',
      source: uploadedDailyVisits(more.sha256),
    });

    expect([unknown, await asked(playbook, { series: 'north', horizon: 1 })]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', detail: 'The dataset holds no series "east" in its window' },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'data_changed',
        detail:
          'The data part changed since version 1 was built, so its model no longer fits the rows; ask for a build',
      },
    ]);
  });
});

describe('a question whose model process does not answer', () => {
  it('fails as the model process failing when it ends, runs out of memory or answers numbers that are not finite', async () => {
    const { scripted, playbook } = await scriptedVisits();
    scripted.next('exits');
    const exited = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('allocates');
    const exhausted = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('not-finite');
    const notFinite = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('unreadable');
    const unread = await asked(playbook, { series: 'north', horizon: 1 });

    expect(unread).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      detail: 'The model process ended before it read the dataset',
    });
    expect([exited, exhausted, notFinite]).toMatchObject([
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        detail: 'The process ended with code 3 before it answered',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        detail: 'The model process ended before it answered',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        detail: 'The model answered something other than finite numbers in the shape its signature gives',
      },
    ]);
  });
});

describe('a question whose model processes are all taken', () => {
  it('is told every model process is busy while every one is taken', async () => {
    const scripted = scriptedModels();
    const deadlines = { check: 60_000, run: 300, walk: 60_000, baselines: 30_000 };
    const playbook = await activeVisits({ module: scripted.module, deadlines, processes: 3, longJobs: 3 });
    scripted.next('sleeps');
    const { models } = playbook.test.ports;
    for (const held of ['first', 'second', 'third']) {
      void Effect.runPromise(models.walk({ sha256: held, path: `/${held}.onnx` }, heldWalk));
    }
    await sleep(100);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_busy',
    });
  });
});
