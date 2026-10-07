import type { Presenter, Registration } from '@beonauto/operations';

import type { Primitive } from '../primitive/primitive.ts';
import { runOperations } from '../reading/run-operations.ts';
import { defineCreateSpec } from './create-spec.ts';
import { defineExecuteSpec } from './execute-spec.ts';
import { defineGetSpec } from './get-spec.ts';
import { defineListSpecs } from './list-specs.ts';
import { defineRetireSpec } from './retire-spec.ts';
import { defineUpdateSpec } from './update-spec.ts';

export interface BrainOperation {
  readonly registration: Registration<'brain'>;
}

export function makeSpecOperations(
  primitives: readonly Primitive[],
  presenters?: readonly Presenter[],
): readonly BrainOperation[] {
  return [
    defineCreateSpec(primitives),
    defineListSpecs(primitives),
    defineGetSpec(primitives),
    defineUpdateSpec(primitives),
    defineRetireSpec(primitives),
    defineExecuteSpec(primitives),
    ...runOperations(primitives, presenters),
  ];
}
