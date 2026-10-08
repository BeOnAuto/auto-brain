import { defineListBrainEvents } from '@beonauto/brains';
import { toolTestPresenter } from '@beonauto/mcp';
import type { Presenter } from '@beonauto/operations';
import {
  makeSpecOperations,
  makeSpecPresenters,
  publishEvent,
  type BrainOperation,
  type Primitive,
} from '@beonauto/specs';

export function brainOperationsServing(
  primitives: readonly Primitive[],
  logPresenters: readonly Presenter[],
): readonly BrainOperation[] {
  const presenters = [...makeSpecPresenters(primitives), toolTestPresenter, ...logPresenters];
  return [...makeSpecOperations(primitives, presenters), defineListBrainEvents(presenters), publishEvent];
}
