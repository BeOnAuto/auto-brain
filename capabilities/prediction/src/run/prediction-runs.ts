import type { CapabilityDeclaration } from '@on.auto/definitions';

import { buildRun } from '../build/build-run.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { buildAnswerIssues } from '../checks/build-answers.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { questionRun } from '../question/question-run.ts';
import { predictionRun } from './prediction-run.ts';
import { finishesLater, finishesLaterFor, longestRunFor, longestRunOf } from './run-lengths.ts';

export type PredictionRuns = Pick<
  CapabilityDeclaration<PredictionFunctionDefinitionDocument>,
  'run' | 'finishesLater' | 'finishesLaterFor' | 'longestRunOf' | 'longestRunFor' | 'answerIssues'
>;

export function predictionRunsOn(ports: PredictionPorts): PredictionRuns {
  return {
    run: (document, input, context) =>
      predictionRun(document, input, context, {
        build: (run) => buildRun(ports, document, run),
        question: (run) => questionRun(ports, document, input, run),
      }),
    finishesLater,
    finishesLaterFor,
    longestRunOf,
    longestRunFor,
    answerIssues: buildAnswerIssues,
  };
}
