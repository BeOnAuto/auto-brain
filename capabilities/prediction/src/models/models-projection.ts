import {
  strictRecordedDecoder,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';
import { Schema } from 'effect';

import { ModelFactSchema, modelFactTypes, modelsStreamKind, type RecordedModelFact } from '../facts/model-facts.ts';

export const predictionModelsName = 'prediction_models';

const ModelsRowSchema = Schema.Struct({
  active: Schema.NullOr(Schema.Int),
  active_data_sha256: Schema.NullOr(Schema.String),
  active_file_sha256: Schema.NullOr(Schema.String),
  latest: Schema.NullOr(Schema.Int),
  versions: Schema.Int,
  challenger: Schema.NullOr(Schema.Int),
  challenger_build: Schema.NullOr(Schema.String),
  shadow_predicted: Schema.Int,
  shadow_graded: Schema.Int,
  shadow: Schema.NullOr(Schema.Literals(['passed', 'failed'])),
});

export type ModelsRow = typeof ModelsRowSchema.Type;

const noModelsRow: ModelsRow = {
  active: null,
  active_data_sha256: null,
  active_file_sha256: null,
  latest: null,
  versions: 0,
  challenger: null,
  challenger_build: null,
  shadow_predicted: 0,
  shadow_graded: 0,
  shadow: null,
};

const decodeRow = Schema.decodeUnknownSync(ModelsRowSchema);

export function modelsRowOf(row: ProjectedRow | undefined): ModelsRow {
  return row === undefined ? noModelsRow : decodeRow(row);
}

function withoutChallenger(row: ModelsRow, version: number): ModelsRow {
  return row.challenger === version ? { ...row, challenger: null, challenger_build: null } : row;
}

function ofTheChallenger(row: ModelsRow, version: number, of: number): boolean {
  return row.challenger === version && of === version;
}

type ShadowFact = Extract<
  RecordedModelFact,
  { readonly type: 'shadow_predicted' | 'shadow_graded' | 'shadow_passed' | 'shadow_failed' }
>;

function shadowed(row: ModelsRow, fact: ShadowFact): ModelsRow {
  if (fact.type === 'shadow_predicted') {
    return ofTheChallenger(row, fact.data.version, fact.data.of)
      ? { ...row, shadow_predicted: row.shadow_predicted + 1 }
      : row;
  }
  if (fact.type === 'shadow_graded') {
    return ofTheChallenger(row, fact.data.version, fact.data.of)
      ? { ...row, shadow_graded: row.shadow_graded + 1 }
      : row;
  }
  return { ...row, shadow: fact.type === 'shadow_passed' ? 'passed' : 'failed' };
}

function changed(row: ModelsRow, fact: RecordedModelFact): ModelsRow {
  if (fact.type === 'version_built') {
    return {
      ...row,
      latest: fact.data.version,
      versions: row.versions + 1,
      challenger: fact.data.version,
      challenger_build: fact.data.build,
      shadow_predicted: 0,
      shadow_graded: 0,
      shadow: null,
    };
  }
  if (fact.type === 'version_activated') {
    const { version, data_sha256: dataSha256, file_sha256: fileSha256 } = fact.data;
    return withoutChallenger(
      { ...row, active: version, active_data_sha256: dataSha256, active_file_sha256: fileSha256 },
      version,
    );
  }
  return fact.type === 'activation_refused' ? withoutChallenger(row, fact.data.version) : shadowed(row, fact);
}

const decodeFact = strictRecordedDecoder(ModelFactSchema);

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow {
  return changed(modelsRowOf(row), decodeFact(message));
}

export const predictionModels: KeyedProjection = {
  name: predictionModelsName,
  version: 1,
  kinds: [modelsStreamKind],
  types: modelFactTypes,
  columns: [
    { name: 'active', kind: 'integer' },
    { name: 'active_data_sha256', kind: 'text' },
    { name: 'active_file_sha256', kind: 'text' },
    { name: 'latest', kind: 'integer' },
    { name: 'versions', kind: 'integer' },
    { name: 'challenger', kind: 'integer' },
    { name: 'challenger_build', kind: 'text' },
    { name: 'shadow_predicted', kind: 'integer' },
    { name: 'shadow_graded', kind: 'integer' },
    { name: 'shadow', kind: 'text' },
  ],
  indexes: [],
  rowAfter,
};
