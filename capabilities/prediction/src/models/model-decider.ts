import { Conflict, NotFound, type Decider } from '@on.auto/operations';
import { Result } from 'effect';

import { predictionDefinitionType } from '../capability/prediction-bounds.ts';
import { ModelFactSchema, type ModelFact, type ModelFactOf, type RecordedModelFact } from '../facts/model-facts.ts';
import {
  builtVersionOf,
  evolveModels,
  noModels,
  versionOfBuild,
  wasGraded,
  wasPredicted,
  type ModelsState,
} from './model-state.ts';

interface Acted {
  readonly at: string;
  readonly by: string;
  readonly name: string;
  readonly definitionVersion: number;
}

type Built = Omit<ModelFactOf<'version_built'>['data'], 'version'>;

type Activation = Omit<ModelFactOf<'version_activated'>['data'], 'data_sha256' | 'file_sha256'>;

export type ModelCommand = Acted &
  (
    | { readonly type: 'build'; readonly card: Built }
    | { readonly type: 'predict'; readonly data: ModelFactOf<'shadow_predicted'>['data'] }
    | { readonly type: 'grade'; readonly data: ModelFactOf<'shadow_graded'>['data'] }
    | { readonly type: 'decide'; readonly passed: boolean; readonly data: ModelFactOf<'shadow_passed'>['data'] }
    | { readonly type: 'activate'; readonly data: Activation }
    | { readonly type: 'refuse'; readonly data: ModelFactOf<'activation_refused'>['data'] }
  );

type Decision = Result.Result<readonly ModelFact[], NotFound | Conflict>;

const nothing: Decision = Result.succeed([]);

function once(already: boolean, fact: ModelFact): Decision {
  return already ? nothing : Result.succeed([fact]);
}

function built(state: ModelsState, card: Built): Decision {
  const version = state.versions.length + 1;
  return once(versionOfBuild(state, card.build) !== undefined, { type: 'version_built', data: { ...card, version } });
}

function activated(state: ModelsState, { name, data }: Extract<ModelCommand, { readonly type: 'activate' }>): Decision {
  const found = builtVersionOf(state, data.version);
  if (found === undefined) {
    return Result.fail(new NotFound({ detail: `Version ${data.version} of ${name} is not built` }));
  }
  if (data.rule !== 'requested') {
    return once(data.build !== undefined && state.settled.has(data.build), {
      type: 'version_activated',
      data: { ...data, data_sha256: found.dataSha256, file_sha256: found.fileSha256 },
    });
  }
  if (state.active === data.version) {
    return Result.fail(
      new Conflict({ detail: `Version ${data.version} of ${name} is already active`, kind: 'already_active' }),
    );
  }
  const unsettled = state.settled.has(found.build) ? {} : { build: found.build };
  return Result.succeed([
    {
      type: 'version_activated',
      data: {
        version: data.version,
        rule: 'requested',
        data_sha256: found.dataSha256,
        file_sha256: found.fileSha256,
        ...unsettled,
      },
    },
  ]);
}

function shadowed(
  command: Extract<ModelCommand, { readonly type: 'predict' | 'grade' | 'decide' }>,
  state: ModelsState,
): Decision {
  if (command.type === 'predict') {
    return once(wasPredicted(state, command.data), { type: 'shadow_predicted', data: command.data });
  }
  if (command.type === 'grade') {
    return once(wasGraded(state, command.data), { type: 'shadow_graded', data: command.data });
  }
  return once(state.verdicts.has(command.data.version), {
    type: command.passed ? 'shadow_passed' : 'shadow_failed',
    data: command.data,
  });
}

function decided(command: ModelCommand, state: ModelsState): Decision {
  if (command.type === 'build') {
    return built(state, command.card);
  }
  if (command.type === 'activate') {
    return activated(state, command);
  }
  return command.type === 'refuse'
    ? once(state.settled.has(command.data.build), { type: 'activation_refused', data: command.data })
    : shadowed(command, state);
}

export const modelsDecider: Decider<ModelsState, ModelCommand, RecordedModelFact, 'not_found' | 'conflict'> = {
  initialState: noModels,
  evolve: evolveModels,
  decide: decided,
  context: (command) => ({
    at: command.at,
    by: command.by,
    definitionType: predictionDefinitionType,
    definitionName: command.name,
    definitionVersion: command.definitionVersion,
  }),
  eventSchema: ModelFactSchema,
};
