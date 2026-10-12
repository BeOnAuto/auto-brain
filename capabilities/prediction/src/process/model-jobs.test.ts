import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { describe, expect, it } from 'vitest';

import { candidateUrl, type CandidateName } from '../build-testing/due-driving.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { modelJobs } from './model-jobs.ts';
import type { LoadedModel, LoadModel } from './model-sessions.ts';

function pathOf(name: CandidateName): string {
  return fileURLToPath(candidateUrl(name));
}

function asked(kind: string, payload: ProcessValue, jobs = modelJobs()) {
  const handler = jobs[kind];
  return Promise.resolve(handler === undefined ? null : handler(payload));
}

const visits = ['series,period,visits', 'north,2026-10-01,10', 'north,2026-10-02,12', 'north,2026-10-03,14'].join(
  '\r\n',
);

function rowsFile(): string {
  const path = join(scratchDirectory(), 'scoring.csv');
  writeFileSync(path, visits);
  return path;
}

function countingLoads(model: LoadedModel | string): { readonly load: LoadModel; readonly loads: () => number } {
  const counted = { loads: 0 };
  return {
    load: () => {
      counted.loads += 1;
      return typeof model === 'string' ? Promise.reject(new Error(model)) : Promise.resolve(model);
    },
    loads: () => counted.loads,
  };
}

const notParsed: unknown = expect.stringMatching(/protobuf parsing failed/iu);

const throwing: LoadedModel = {
  length: undefined,
  inputs: [],
  outputs: [],
  run: () => Promise.reject(new Error('The session was closed')),
};

describe('the check of a model file in its process', () => {
  it('answers the signature and the operator set of a model, and why a file that is not one did not load', async () => {
    expect(await asked('check', { model: pathOf('visits-mean'), threads: 1 })).toEqual({
      loaded: true,
      inputs: [{ name: 'y', type: 'float32', shape: [1, 'L'] }],
      outputs: [{ name: 'q', type: 'float32', shape: [1, 2, 3] }],
      opset: 13,
    });
    expect(await asked('check', { model: pathOf('not-a-model'), threads: 1 })).toMatchObject({
      loaded: false,
      detail: notParsed,
    });
  });
});

describe('a question run in a model process', () => {
  it('answers q and its dimensions', async () => {
    const answer = await asked('run', {
      model: pathOf('visits-mean'),
      threads: 1,
      y: Float32Array.of(10, 12),
      x: null,
      given: null,
      h: null,
      features: 0,
      givens: 0,
    });

    expect(answer).toEqual({ q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] });
  });

  it('answers badly for a model that answers no float32, and fails for what else goes wrong', async () => {
    const question = { threads: 1, y: Float32Array.of(1), x: null, given: null, h: null, features: 0, givens: 0 };

    expect(await asked('run', { ...question, model: pathOf('visits-whole-numbers') })).toEqual({
      badly: 'The model answered no q of float32',
    });
    await expect(
      asked('run', { ...question, model: 'closing' }, modelJobs(countingLoads(throwing).load)),
    ).rejects.toThrow('The session was closed');
  });

  it('fails, so that its process is let go, for a model that answers a number that is not finite', async () => {
    const question = { threads: 1, y: Float32Array.of(1), x: null, given: null, h: null, features: 0, givens: 0 };
    const answeringNaN: LoadedModel = {
      length: undefined,
      inputs: [],
      outputs: [],
      run: () => Promise.resolve({ data: Float32Array.of(9, Number.NaN, 13), dims: [1, 1, 3] }),
    };

    const failed = await asked('run', { ...question, model: 'nan' }, modelJobs(countingLoads(answeringNaN).load)).catch(
      String,
    );

    expect(failed).toBe('The model answered a number that is not finite');
  });
});

describe('a walk in a model process', () => {
  it('answers the q of each held-back origin of each series in the rows file', async () => {
    const answer = await asked('walk', {
      model: pathOf('visits-mean'),
      threads: 1,
      rows: rowsFile(),
      window: 3,
      holdout: 1,
      steps: 2,
      features: 0,
      given: [],
      remaining: null,
    });

    expect(answer).toEqual({ series: ['north'], q: [Float32Array.of(10, 12, 14, 10, 12, 14)] });
  });

  it('answers badly for a model that answers no float32', async () => {
    const walk = {
      threads: 1,
      rows: rowsFile(),
      window: 3,
      holdout: 1,
      steps: 2,
      features: 0,
      given: [],
      remaining: null,
    };

    expect(await asked('walk', { ...walk, model: pathOf('visits-whole-numbers') })).toEqual({
      badly: 'The model answered no q of float32',
    });
  });
});

describe('the sessions a model process keeps', () => {
  it('load a file once for every job on it, and load it again after a load that failed', async () => {
    const loaded = countingLoads(throwing);
    const failing = countingLoads('No such file');
    const jobs = modelJobs(loaded.load);
    const failingJobs = modelJobs(failing.load);

    await asked('check', { model: 'same', threads: 1 }, jobs).catch(() => null);
    await asked('check', { model: 'same', threads: 1 }, jobs).catch(() => null);
    const first = await asked('check', { model: 'gone', threads: 1 }, failingJobs);
    await asked('check', { model: 'gone', threads: 1 }, failingJobs);

    expect([loaded.loads(), failing.loads(), first]).toEqual([1, 2, { loaded: false, detail: 'No such file' }]);
  });
});
