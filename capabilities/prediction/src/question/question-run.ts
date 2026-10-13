import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Option, Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { enclosingOf, periodsToTheEnd } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import { activeVersionOf } from './active-version.ts';
import { seriesWindow, type SeriesWindow } from './series-window.ts';

const QuestionSchema = Schema.Struct({
  series: Schema.String,
  horizon: Schema.optionalKey(Schema.Int),
  given: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
});

type Question = typeof QuestionSchema.Type;

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

const ended = new Unavailable({ detail: 'The model process ended before it answered', kind: 'model_process_failed' });

const notFinite = new Unavailable({
  detail: 'The model answered something other than finite numbers in the shape its signature gives',
  kind: 'model_process_failed',
  because: 'not_finite',
});

interface Asked {
  readonly steps: number;
  readonly period: string;
  readonly horizon: number;
  readonly step: number;
}

function askedOf({ predicts }: PredictionFunctionDefinitionDocument, origin: number, question: Question): Asked {
  const { period: grain, accumulates } = predicts;
  if (accumulates === undefined) {
    const horizon = Number(question.horizon);
    return {
      steps: Math.max(...predicts.horizons),
      period: periodForm(grain, origin + horizon),
      horizon,
      step: horizon - 1,
    };
  }
  const remaining = periodsToTheEnd(grain, accumulates, origin);
  return {
    steps: remaining,
    period: periodForm(accumulates, enclosingOf(grain, accumulates, origin + 1)),
    horizon: remaining,
    step: 0,
  };
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
    const asked = askedOf(document, window.origin, question);
    const kept = yield* ports.caches.models.pathOf(active.file, () => ports.ledger.content.get(playbook, active.file));
    const path = Option.getOrThrow(Option.fromNullishOr(kept));
    const outcome = yield* ports.models.run(
      { sha256: active.file, path },
      {
        y: window.y,
        x: window.x,
        given: givenOf(document, question, asked.steps),
        h: document.predicts.accumulates === undefined ? null : asked.horizon,
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
    const expected = `1,${document.predicts.accumulates === undefined ? asked.steps : 1},3`;
    const [low, value, high] = outcome.answer.q.subarray(asked.step * 3, asked.step * 3 + 3);
    const numbers = [low, value, high].map(Number);
    if (outcome.answer.dims.join(',') !== expected || !numbers.every((each) => Number.isFinite(each))) {
      return yield* Effect.fail(notFinite);
    }
    return { asked, numbers, milliseconds: outcome.milliseconds };
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
    const { asked, numbers, milliseconds } = yield* answered({ ports, playbook, document, question }, active, window);
    const [low, value, high] = numbers;
    return {
      output: {
        series: question.series,
        origin: periodForm(document.predicts.period, window.origin),
        period: asked.period,
        horizon: asked.horizon,
        value: Number(value),
        low: Number(low),
        high: Number(high),
        coverage: 0.8,
        version: active.version,
      },
      record: {
        version: active.version,
        origin: periodForm(document.predicts.period, window.origin),
        dataset_checkpoint: window.checkpoint,
        duration_ms: Math.round(milliseconds),
      },
    };
  });
}
