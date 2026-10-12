import { definitionVersionIn } from '@on.auto/definitions';
import type { StreamReader } from '@on.auto/operations';
import { Effect, Option, Result } from 'effect';

import { predictionDefinitionType } from '../capability/prediction-bounds.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { BuildState } from './build-state.ts';

export function documentOfBuild(
  reader: StreamReader,
  { address, run }: BuildState,
): Effect.Effect<PredictionFunctionDefinitionDocument> {
  const { org, playbook } = address;
  return Effect.map(
    definitionVersionIn(
      reader,
      { org, playbook },
      {
        type: predictionDefinitionType,
        name: run.run.name,
        version: run.run.definition_version,
      },
    ),
    (found) => Result.getOrThrow(parsePredictionDocument(Option.getOrThrow(Option.fromNullishOr(found)).source)),
  );
}
