import { defineListBrainEvents } from '@beonauto/brains';
import type { Presenter } from '@beonauto/operations';
import { makeSpecOperations, makeSpecPresenters, type BrainOperation, type Primitive } from '@beonauto/specs';

export function brainOperationsServing(
  primitives: readonly Primitive[],
  logPresenters: readonly Presenter[],
): readonly BrainOperation[] {
  const presenters = [...makeSpecPresenters(primitives), ...logPresenters];
  return [...makeSpecOperations(primitives, presenters), defineListBrainEvents(presenters)];
}
