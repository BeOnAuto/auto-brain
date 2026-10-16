import type { RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, askedBuild, buildAsked, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { scriptedModels } from '../build-testing/scripted-models.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';

const runIds = ['0199a3c4-7d2e-7c1a-9b3f-555555555561', '0199a3c4-7d2e-7c1a-9b3f-555555555562'];

const stillFrom = 30;

function stillOf(series: string): number {
  return series === 'north' ? 10 : 20;
}

function stillSeries(series: string, day: number): number {
  return day < stillFrom ? steadyVisits(series, day) : stillOf(series);
}

function southMoving(series: string, day: number): number {
  return series === 'south' ? steadyVisits(series, day) : stillSeries(series, day);
}

function movingOnlyWhenHeldBack(series: string, day: number): number {
  return day < 32 ? stillOf(series) : steadyVisits(series, day);
}

const still = dailyRows('visits', ['north', 'south'], 40, stillSeries);

const oneMoving = dailyRows('visits', ['north', 'south'], 40, southMoving);

const stillWhileTrained = dailyRows('visits', ['north', 'south'], 40, movingOnlyWhenHeldBack);

interface KeptTypes {
  readonly content: (kept: RecordedContent) => RecordedContent;
  readonly types: () => readonly string[];
}

function keptTypes(): KeptTypes {
  const types: string[] = [];
  return {
    content: (kept) => ({
      ...kept,
      put: (playbook, content) =>
        Effect.andThen(
          Effect.sync(() => {
            types.push(content.mediaType);
          }),
          kept.put(playbook, content),
        ),
    }),
    types: () => [...types],
  };
}

const heldWalk = { rows: '/held.csv', window: 3, holdout: 1, steps: 1, features: 0, given: [], remaining: null };

describe('a build whose baseline already predicts every period held back exactly', () => {
  it('is refused once its rows are written, before its brief is kept or its trainer asked, and takes none of the builds of the day', async () => {
    const kept = keptTypes();
    const playbook = buildPlaybook({ bounds: { buildsPerDay: 1 }, content: kept.content });
    await savedFunction(playbook, { rows: still });
    const keptBefore = kept.types().length;
    const refused = [
      await asked(playbook, { build: {} }, { runId: String(runIds[0]) }),
      await asked(playbook, { build: {} }, { runId: String(runIds[1]) }),
    ];

    expect(refused).toMatchObject(
      runIds.map(() => ({
        status: 'rejected',
        reason: 'conflict',
        kind: 'baseline_perfect',
        detail:
          'The baseline persistence already scores 0 on mase at every period held back where mase scores it, the best a score can be, so no candidate can beat it; ask for a build once the series moves',
      })),
    );
    expect(kept.types().slice(keptBefore)).toEqual(['text/csv', 'text/csv', 'text/csv', 'text/csv']);
    expect(await Promise.all(runIds.map((runId) => workOf(playbook, runId)))).toEqual([[], []]);
    expect(await runOf(playbook, String(runIds[0]))).not.toHaveProperty('output.record');
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [] },
    });
  });
});

describe('a build whose baseline does not score 0 where its metric scores it', () => {
  it('goes ahead and asks its trainer when the baseline misses a period held back of one series', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook, { rows: oneMoving });
    const build = await askedBuild(playbook);

    expect(await workOf(playbook, build)).toMatchObject([{ type: 'dataset_assembled' }]);
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [{ run_id: build }] },
    });
  });

  it('goes ahead when its metric scores no period held back, as mase scores none of series still while trained', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook, { rows: stillWhileTrained });

    expect(await buildAsked(playbook)).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
  });
});

describe('a build whose baselines cannot be checked', () => {
  it('is refused as unavailable while every model process a build may hold is busy', async () => {
    const scripted = scriptedModels();
    const deadlines = { check: 60_000, run: 10_000, walk: 60_000, baselines: 300 };
    const playbook = buildPlaybook({ module: scripted.module, deadlines, processes: 3, longJobs: 2 });
    await savedFunction(playbook, { rows: still });
    scripted.next('sleeps');
    for (const held of ['first', 'second']) {
      void Effect.runPromise(playbook.test.ports.models.walk({ sha256: held, path: `/${held}.onnx` }, heldWalk));
    }
    await scripted.untilSleeping(['walk', 'walk']);
    const whileBusy = await buildAsked(playbook);

    expect(whileBusy).toMatchObject({ status: 'rejected', reason: 'unavailable', kind: 'model_process_busy' });
  });

  it('is refused as unavailable when the process that checks them ends before it answers', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({ module: scripted.module });
    await savedFunction(playbook, { rows: still });
    scripted.next('exits');

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      detail: 'The model process that checks the baselines ended before it answered; ask for the build again',
    });
  });
});
