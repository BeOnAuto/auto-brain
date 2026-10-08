import { setTimeout } from 'node:timers/promises';

import { Effect, Predicate } from 'effect';

import { definePrimitive, type FinishesLater, type Primitive } from '../index.ts';

export interface Relay {
  readonly primitive: Primitive;
  readonly runs: () => number;
  readonly started: Promise<void>;
}

export function relay(): Relay {
  let runs = 0;
  const starting = Promise.withResolvers<void>();
  const primitive = definePrimitive({
    name: 'relay',
    title: 'Relay',
    guide: { name: 'relay' },
    noun: { one: 'relay', other: 'relays' },
    describeOutput: () => 'It handed its input on.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    execute: (_document, input, execution) =>
      Effect.promise(() => {
        starting.resolve();
        return setTimeout(startingMs(input));
      }).pipe(
        Effect.map((): FinishesLater => {
          runs += 1;
          const padding = Predicate.isNumber(input) ? { padding: 'x'.repeat(input) } : {};
          return { finishesLater: true, record: { handed_on: execution.id, ...padding } };
        }),
      ),
    whenCancelled: 'finish',
  });
  return { primitive, runs: () => runs, started: starting.promise };
}

function startingMs(input: unknown): number {
  return Predicate.hasProperty(input, 'startingMs') && Predicate.isNumber(input.startingMs) ? input.startingMs : 0;
}
