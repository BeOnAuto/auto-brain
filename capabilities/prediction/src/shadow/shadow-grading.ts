import { textOfContent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { Performing } from '../builds/build-performing.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { executed } from '../models/model-commands.ts';
import type { BuiltVersion, ModelsState, ShadowPrediction } from '../models/model-state.ts';
import { periodOfForm } from '../periods/grains.ts';
import { gradeOf, predictionsOf, type Aimed } from './shadow-grades.ts';
import { targetsOf, type ShadowTarget } from './shadow-schedule.ts';
import { truthsOf } from './shadow-truths.ts';

export interface Shadowing {
  readonly document: PredictionFunctionDefinitionDocument;
  readonly models: ModelsState;
  readonly challenger: BuiltVersion;
  readonly active: BuiltVersion;
}

function aimedOf(performing: Performing, prediction: ShadowPrediction, horizon: number | null): Effect.Effect<Aimed> {
  const { org, playbook } = performing.build.address;
  return Effect.gen(function* () {
    const content = yield* performing.ports.ledger.content.get({ org, playbook }, prediction.predictions_sha256);
    const text = yield* textOfContent(Option.getOrThrow(Option.fromNullishOr(content)));
    return { predictions: Option.getOrThrow(predictionsOf(text)), horizon };
  });
}

export function graded(
  performing: Performing,
  { document, models, challenger }: Shadowing,
  of: number,
  target: ShadowTarget,
): Effect.Effect<void> {
  const { org, playbook } = performing.build.address;
  const aimedAt = models.predicted
    .filter((each) => each.version === challenger.version && each.of === of)
    .flatMap((prediction) =>
      targetsOf(document.predicts, Number(periodOfForm(document.predicts.period, prediction.origin)))
        .filter(({ form }) => form === target.form)
        .map(({ horizon }) => aimedOf(performing, prediction, horizon)),
    );
  return Effect.gen(function* () {
    const aimed = yield* Effect.all(aimedAt);
    const grade = gradeOf(aimed, yield* truthsOf(performing.ports, { org, playbook }, document, target));
    return yield* executed(performing, (asked) => ({
      ...asked,
      type: 'grade',
      definitionVersion: challenger.definitionVersion,
      data: { version: challenger.version, of, build: performing.build.address.id, period: target.form, ...grade },
    }));
  });
}
