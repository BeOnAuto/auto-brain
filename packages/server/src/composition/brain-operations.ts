import { defineListBrainEvents } from '@beonauto/brains';
import { makeSpecOperations, makeSpecPresenters, type BrainOperation, type Primitive } from '@beonauto/specs';

export function brainOperationsServing(primitives: readonly Primitive[]): readonly BrainOperation[] {
  const presenters = makeSpecPresenters(primitives);
  return [...makeSpecOperations(primitives, presenters), defineListBrainEvents(presenters)];
}
