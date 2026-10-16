import { outputInWords } from '@on.auto/definitions';
import { listed } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { figure } from './figures.ts';

const PredictedPointSchema = Schema.Struct({
  at: Schema.String,
  value: Schema.Number,
  low: Schema.Number,
  high: Schema.Number,
});

const PredictionSchema = Schema.Struct({
  origin: Schema.String,
  lines: Schema.Tuple([
    Schema.Struct({ name: Schema.Literal('observed') }),
    Schema.Struct({ name: Schema.Literal('predicted'), points: Schema.NonEmptyArray(PredictedPointSchema) }),
  ]),
});

const VersionSchema = Schema.Struct({ version: Schema.Number });

const BuildSchema = Schema.Struct({
  version: Schema.NullOr(Schema.Number),
  winner: Schema.NullOr(Schema.String),
  candidates: Schema.Array(Schema.Unknown),
});

const decodePrediction = Schema.decodeUnknownOption(PredictionSchema);

const decodeVersion = Schema.decodeUnknownOption(VersionSchema);

const decodeBuild = Schema.decodeUnknownOption(BuildSchema);

const asAResult = outputInWords('result');

type PredictedPoint = typeof PredictedPointSchema.Type;

function pointWords({ at, value, low, high }: PredictedPoint): string {
  return `${figure(value)} in ${at} (${figure(low)} to ${figure(high)})`;
}

function versionWords(record: unknown): string {
  return Option.match(decodeVersion(record), {
    onSome: ({ version }) => `, from version ${version} of its model`,
    onNone: () => '',
  });
}

function predictionWords({ origin, lines }: typeof PredictionSchema.Type, record: unknown): string {
  const [, { points }] = lines;
  const each = points.length === 1 ? 'its range holding' : 'each range holding';
  return `From ${origin}, it predicts ${listed(points.map((point) => pointWords(point)))}, ${each} the truth eight times in ten${versionWords(record)}.`;
}

function buildWords({ version, winner, candidates }: typeof BuildSchema.Type): string {
  const scored = candidates.length === 1 ? 'one candidate' : `${candidates.length} candidates`;
  if (version !== null && winner !== null) {
    return `The build made version ${version} of its model from ${scored}, won by ${winner.slice(0, 12)}.`;
  }
  return candidates.length === 0
    ? 'The build kept no version, since no candidate was uploaded before its answer.'
    : `The build kept no version: none of its ${scored} beat the baselines on the held-back periods.`;
}

export function describeOutput(output: Schema.Json, record?: Schema.JsonObject): string {
  return Option.match(decodePrediction(output), {
    onSome: (prediction) => predictionWords(prediction, record),
    onNone: () => Option.match(decodeBuild(output), { onSome: buildWords, onNone: () => asAResult(output) }),
  });
}
