import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@beonauto/definitions';

import { finishesLater, interactionRun } from '../run/interaction-run.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { parse, summarize } from './definition-reading.ts';
import { interactionType } from './interaction-type.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';
import { cancelledRequest } from './request-cancels.ts';

export function makeInteractionFunctionAdapter(ports: InteractionPorts): Capability {
  const run = interactionRun(ports);
  const reachesOutside = ports.tools.configured;
  return defineCapability({
    type: interactionType,
    title: functionCategoryLabels.interact,
    guide: { name: 'interaction-function' },
    noun: { one: functionResourceLabels.interact.singular, other: functionResourceLabels.interact.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    parse,
    summarize,
    run: (document, input, context) => run(document, input, context),
    whenCancelled: 'finish',
    reachesOutside,
    mayChangeOutside: reachesOutside,
    finishesLater,
    longestRunOf: ({ expiresMs }) => expiresMs,
    runWords: interactionRunWords,
    cancel: cancelledRequest,
  });
}
