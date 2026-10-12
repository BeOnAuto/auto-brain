import { outputInWords } from '@on.auto/definitions';
import { plainNumber, quoted } from '@on.auto/operations';
import { Option, Schema } from 'effect';

const PredictionSchema = Schema.Struct({
  series: Schema.String,
  period: Schema.String,
  horizon: Schema.Number,
  value: Schema.Number,
  low: Schema.Number,
  high: Schema.Number,
  version: Schema.Number,
});

const BuildSchema = Schema.Struct({
  version: Schema.NullOr(Schema.Number),
  winner: Schema.NullOr(Schema.String),
  candidates: Schema.Array(Schema.Unknown),
});

const decodePrediction = Schema.decodeUnknownOption(PredictionSchema);

const decodeBuild = Schema.decodeUnknownOption(BuildSchema);

const asAResult = outputInWords('result');

function predictionWords({ series, period, horizon, value, low, high, version }: typeof PredictionSchema.Type): string {
  return `It predicts ${plainNumber(value)} for ${quoted(series)} in ${period}, ${horizon === 1 ? 'one period' : `${horizon} periods`} ahead, between ${plainNumber(low)} and ${plainNumber(high)} eight times in ten, from version ${version} of its model.`;
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

export function describeOutput(output: Schema.Json): string {
  return Option.match(decodePrediction(output), {
    onSome: predictionWords,
    onNone: () => Option.match(decodeBuild(output), { onSome: buildWords, onNone: () => asAResult(output) }),
  });
}
