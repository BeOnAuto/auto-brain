import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Option, Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument, Predicts } from '../document/prediction-document.ts';
import { enclosingOf, periodsToTheEnd } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import { activeVersionOf } from './active-version.ts';
import { checkedAnswer } from './answer-check.ts';
import { seriesWindow, type SeriesWindow } from './series-window.ts';

const QuestionSchema = Schema.Struct({
  series: Schema.String,
  horizon: Schema.optionalKey(Schema.Int),
  given: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  marks: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.Number }))),
});

type Question = typeof QuestionSchema.Type;

const coverage = 0.8;

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

const ended = new Unavailable({ detail: 'The model process ended before it answered', kind: 'model_process_failed' });

const notFinite = new Unavailable({
  detail: 'The model answered something other than finite numbers in the shape its signature gives',
  kind: 'model_process_failed',
  because: 'not_finite',
});

interface AskedPoint {
  readonly step: number;
  readonly period: number;
}

interface Asked {
  readonly steps: number;
  readonly summed: number | null;
  readonly points: readonly AskedPoint[];
}

type ObservedPoint = { readonly at: string; readonly value: number };

type PredictedPoint = ObservedPoint & { readonly low: number; readonly high: number };

function askedOf({ period: grain, horizons, accumulates }: Predicts, origin: number, question: Question): Asked {
  if (accumulates === undefined) {
    const asked =
      question.horizon === undefined ? horizons.toSorted((left, right) => left - right) : [question.horizon];
    return {
      steps: Math.max(...horizons),
      summed: null,
      points: asked.map((horizon) => ({ step: horizon - 1, period: origin + horizon })),
    };
  }
  const remaining = periodsToTheEnd(grain, accumulates, origin);
  return { steps: remaining, summed: remaining, points: [{ step: 0, period: origin + remaining }] };
}

function aheadOf({ period: grain, accumulates }: Predicts, origin: number) {
  return accumulates === undefined
    ? { line: 'predicted', record: {} }
    : { line: 'total', record: { total_to: periodForm(accumulates, enclosingOf(grain, accumulates, origin + 1)) } };
}

function givenOf(
  document: PredictionFunctionDefinitionDocument,
  { given }: Question,
  steps: number,
): Float32Array | null {
  if (given === undefined) {
    return null;
  }
  const values = document.data.given.map((name) => Number(given[name]));
  return Float32Array.from(Array.from({ length: steps }, () => values).flat());
}

function predictedOf(
  q: Readonly<Float32Array>,
  { period: grain }: Predicts,
  points: readonly AskedPoint[],
): readonly PredictedPoint[] | undefined {
  const predicted: readonly PredictedPoint[] = points.map(({ step, period }) => {
    const [low, value, high] = Array.from(q.subarray(step * 3, step * 3 + 3));
    return { at: periodForm(grain, period), value: Number(value), low: Number(low), high: Number(high) };
  });
  return predicted.every(({ low, value, high }) => [low, value, high].every((each) => Number.isFinite(each)))
    ? predicted
    : undefined;
}

function observedOf({ y, origin }: SeriesWindow, { period: grain, history }: Predicts): readonly ObservedPoint[] {
  const first = origin - history + 1;
  const shown: readonly ObservedPoint[] = Array.from(y.subarray(y.length - history), (value, at) => ({
    at: periodForm(grain, first + at),
    value,
  }));
  return shown.filter(({ value }) => Number.isFinite(value));
}

interface Answering {
  readonly ports: PredictionPorts;
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly question: Question;
}

function answered(
  { ports, playbook, document, question }: Answering,
  active: { readonly version: number; readonly file: string },
  window: SeriesWindow,
) {
  return Effect.gen(function* () {
    const asked = askedOf(document.predicts, window.origin, question);
    const kept = yield* ports.caches.models.pathOf(active.file, () => ports.ledger.content.get(playbook, active.file));
    const path = Option.getOrThrow(Option.fromNullishOr(kept));
    const outcome = yield* ports.models.run(
      { sha256: active.file, path },
      {
        y: Float32Array.from(window.y),
        x: window.x,
        given: givenOf(document, question, asked.steps),
        h: asked.summed,
        features: document.data.features.length,
        givens: document.data.given.length,
      },
    );
    if (outcome.ended === 'busy') {
      return yield* Effect.fail(busy);
    }
    if (outcome.ended === 'crashed') {
      return yield* Effect.fail(new Unavailable({ detail: outcome.detail, kind: 'model_process_failed' }));
    }
    if (outcome.ended !== 'answered') {
      return yield* Effect.fail(ended);
    }
    const expected = `1,${asked.summed === null ? asked.steps : 1},3`;
    const predicted = predictedOf(outcome.answer.q, document.predicts, asked.points);
    if (outcome.answer.dims.join(',') !== expected || predicted === undefined) {
      return yield* Effect.fail(notFinite);
    }
    return { predicted, milliseconds: outcome.milliseconds };
  });
}

export function questionRun(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const playbook = { org: context.org, playbook: context.playbook };
  const question = Schema.decodeUnknownSync(QuestionSchema)(input);
  const { predicts } = document;
  return Effect.gen(function* () {
    const active = yield* activeVersionOf({
      ledger: ports.ledger,
      playbook,
      name: context.definition.name,
      definitionVersion: context.definition.version,
      document,
    });
    const now = yield* Clock.currentTimeMillis;
    const window = yield* seriesWindow(ports, { playbook, document, series: question.series, now });
    const { predicted, milliseconds } = yield* answered({ ports, playbook, document, question }, active, window);
    const origin = periodForm(predicts.period, window.origin);
    const ahead = aheadOf(predicts, window.origin);
    const output = {
      unit: predicts.unit,
      period: predicts.period,
      origin,
      lines: [
        { name: 'observed', points: observedOf(window, predicts) },
        { name: ahead.line, points: predicted },
      ],
      ...(question.marks === undefined ? {} : { marks: question.marks }),
    };
    yield* checkedAnswer(output);
    return {
      output,
      record: {
        version: active.version,
        coverage,
        ...ahead.record,
        origin,
        dataset_checkpoint: window.checkpoint,
        duration_ms: Math.round(milliseconds),
      },
    };
  });
}
