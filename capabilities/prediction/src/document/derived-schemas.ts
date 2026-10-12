import { compileJsonSchema, type CompiledSchema } from '@on.auto/definitions/document';
import { Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { DataPart, DerivedSchemas, Predicts } from './prediction-document.ts';

const periodWords = 'in the ISO 8601 form of the grain: YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY-Qn or YYYY';

function givenSchema(given: readonly string[]): Schema.JsonObject {
  return {
    type: 'object',
    description: 'The value of each given feature for the period predicted, by its name',
    required: [...given],
    additionalProperties: false,
    properties: Object.fromEntries(given.map((name) => [name, { type: 'number' }])),
  };
}

function questionSchema({ horizons, unit }: Predicts, { given }: Pick<DataPart, 'given'>): Schema.JsonObject {
  return {
    type: 'object',
    title: 'question',
    description: `A question: the series and the horizon to predict, in ${unit}`,
    required: given.length === 0 ? ['series', 'horizon'] : ['series', 'horizon', 'given'],
    additionalProperties: false,
    properties: {
      series: {
        type: 'string',
        minLength: 1,
        maxLength: predictionBounds.mostSeriesBytes,
        description: `The series, text of 1 to ${predictionBounds.mostSeriesBytes} bytes in UTF-8`,
      },
      horizon: { type: 'integer', enum: [...horizons], description: 'How many periods ahead of the last observed' },
      ...(given.length === 0 ? {} : { given: givenSchema(given) }),
    },
  };
}

const buildInputSchema: Schema.JsonObject = {
  type: 'object',
  title: 'build',
  description: 'A build: asks a trainer for candidate models, scores them and keeps the winner as a version',
  required: ['build'],
  additionalProperties: false,
  properties: { build: { type: 'object', additionalProperties: false, properties: {} } },
};

const predictionSchema: Schema.JsonObject = {
  type: 'object',
  title: 'prediction',
  required: ['series', 'origin', 'period', 'horizon', 'value', 'low', 'high', 'coverage', 'version'],
  additionalProperties: false,
  properties: {
    series: { type: 'string' },
    origin: { type: 'string', description: `The last observed period, ${periodWords}` },
    period: { type: 'string', description: `The period predicted, ${periodWords}` },
    horizon: { type: 'integer', minimum: 1 },
    value: { type: 'number', description: 'The likely value, the 50th percentile' },
    low: { type: 'number', description: 'The 10th percentile' },
    high: { type: 'number', description: 'The 90th percentile' },
    coverage: { const: 0.8, description: 'The share of truths low and high are meant to hold' },
    version: { type: 'integer', minimum: 1, description: 'The version of the model that answered' },
  },
};

const buildOutputSchema: Schema.JsonObject = {
  type: 'object',
  title: 'build',
  required: ['version', 'winner', 'candidates'],
  additionalProperties: false,
  properties: {
    version: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }], description: 'The version built, if any' },
    winner: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'The SHA-256 of the winning candidate' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sha256', 'verdict'],
        additionalProperties: false,
        properties: { sha256: { type: 'string' }, verdict: { type: 'string' } },
      },
    },
  },
};

function compiled(document: Schema.JsonObject, what: string): CompiledSchema {
  return Result.getOrThrow(compileJsonSchema(document, { what, nesting: 16 }));
}

const buildInput = compiled(buildInputSchema, 'input');

const outputSchema: Schema.JsonObject = { oneOf: [predictionSchema, buildOutputSchema] };

export function derivedSchemasOf(predicts: Predicts, data: Pick<DataPart, 'given'>): DerivedSchemas {
  const question = questionSchema(predicts, data);
  return {
    input: { oneOf: [question, buildInputSchema] },
    output: outputSchema,
    question: compiled(question, 'input'),
    build: buildInput,
  };
}
