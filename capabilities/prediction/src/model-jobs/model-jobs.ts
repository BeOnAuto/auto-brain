import { readFileSync } from 'node:fs';

import type { ProcessHandlers, ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { Schema } from 'effect';

import { seriesRowsIn } from '../files/series-rows.ts';
import { perfectBaselineIn } from './baselines-job.ts';
import {
  BaselinesJobSchema,
  CheckJobSchema,
  feedsOf,
  RunJobSchema,
  WalkJobSchema,
  WindowJobSchema,
} from './model-feeds.ts';
import { AnsweredBadly, firstLineOf, loadWithOnnxRuntime, type LoadedModel, type LoadModel } from './model-sessions.ts';
import { opsetOf } from './onnx-opset.ts';
import { walked } from './walk-job.ts';
import { seriesWindowIn } from './window-job.ts';

const decodeCheck = Schema.decodeUnknownSync(CheckJobSchema);

const decodeRun = Schema.decodeUnknownSync(RunJobSchema);

const decodeWalk = Schema.decodeUnknownSync(WalkJobSchema);

const decodeWindow = Schema.decodeUnknownSync(WindowJobSchema);

const decodeBaselines = Schema.decodeUnknownSync(BaselinesJobSchema);

type Sessions = (path: string, threads: number) => Promise<LoadedModel>;

class AnsweredNotFinite extends Error {
  override toString(): string {
    return this.message;
  }
}

function sessionsOf(load: LoadModel): Sessions {
  const loaded = new Map<string, Promise<LoadedModel>>();
  return (path, threads) => {
    const known = loaded.get(path);
    if (known !== undefined) {
      return known;
    }
    const loading = load(path, threads);
    loaded.set(path, loading);
    loading.catch(() => loaded.delete(path));
    return loading;
  };
}

async function badlyOr(answering: () => Promise<ProcessValue>): Promise<ProcessValue> {
  try {
    return await answering();
  } catch (error) {
    if (error instanceof AnsweredBadly) {
      return { badly: error.message };
    }
    throw error;
  }
}

async function checked(sessions: Sessions, payload: ProcessValue): Promise<ProcessValue> {
  const { model, threads } = decodeCheck(payload);
  try {
    const { inputs, outputs } = await sessions(model, threads);
    return { loaded: true, inputs, outputs, opset: opsetOf(readFileSync(model)) };
  } catch (error) {
    return { loaded: false, detail: firstLineOf(error) };
  }
}

export function modelJobs(load: LoadModel = loadWithOnnxRuntime): ProcessHandlers {
  const sessions = sessionsOf(load);
  return {
    check: (payload) => checked(sessions, payload),
    run: (payload) =>
      badlyOr(async () => {
        const job = decodeRun(payload);
        const model = await sessions(job.model, job.threads);
        const answer = await model.run(feedsOf(job, model.length));
        if (!answer.data.every((value) => Number.isFinite(value))) {
          throw new AnsweredNotFinite('The model answered a number that is not finite');
        }
        return { q: answer.data, dims: answer.dims };
      }),
    window: (payload) => seriesWindowIn(decodeWindow(payload)),
    baselines: async (payload) => ({ ...(await perfectBaselineIn(decodeBaselines(payload))) }),
    walk: (payload) =>
      badlyOr(async () => {
        const job = decodeWalk(payload);
        return walked(
          await sessions(job.model, job.threads),
          job,
          await seriesRowsIn(job.rows, { features: job.features }),
        );
      }),
  };
}
