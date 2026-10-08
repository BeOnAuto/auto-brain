import { definePrimitive, functionCategoryLabels, functionResourceLabels, type Primitive } from '@beonauto/specs';

import { finishesLater, interactionRun } from '../run/interaction-run.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { parse, summarize } from './definition-reading.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';
import { interactionPrimitive } from './primitive-name.ts';
import { cancelledRequest } from './request-cancels.ts';

export function makeInteractionFunctionAdapter(ports: InteractionPorts): Primitive {
  const run = interactionRun(ports);
  const reachesOutside = ports.channels.channels.size > 0;
  return definePrimitive({
    name: interactionPrimitive,
    title: functionCategoryLabels.interact,
    guide: { name: 'interaction-function' },
    noun: { one: functionResourceLabels.interact.singular, other: functionResourceLabels.interact.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    parse,
    summarize,
    execute: (document, input, context) => run(document, input, context),
    whenCancelled: 'finish',
    reachesOutside,
    mayChangeOutside: reachesOutside,
    finishesLater,
    longestRunOf: ({ expiresMs }) => expiresMs,
    runWords: interactionRunWords,
    cancel: cancelledRequest,
  });
}
