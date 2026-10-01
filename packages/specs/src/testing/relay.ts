import { Effect, Predicate } from 'effect';

import { definePrimitive, type FinishesLater, type Primitive } from '../index.ts';

export interface Relay {
  readonly primitive: Primitive;
  readonly runs: () => number;
}

export function relay(): Relay {
  let runs = 0;
  const primitive = definePrimitive({
    name: 'relay',
    title: 'Relay',
    description:
      'Hands its input on to work that finishes after the call returns. A spec document of relay is plain text.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    execute: (_document, input, execution) =>
      Effect.sync((): FinishesLater => {
        runs += 1;
        const padding = Predicate.isNumber(input) ? { padding: 'x'.repeat(input) } : {};
        return { finishesLater: true, record: { handed_on: execution.id, ...padding } };
      }),
  });
  return { primitive, runs: () => runs };
}
