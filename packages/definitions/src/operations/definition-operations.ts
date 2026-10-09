import type { Presenter, Registration } from '@beonauto/operations';

import type { Capability } from '../capability/capability.ts';
import { runOperations } from '../reading/run-operations.ts';
import { defineCreateDefinition } from './create-definition.ts';
import { defineGetDefinition } from './get-definition.ts';
import { defineListDefinitions } from './list-definitions.ts';
import { defineRetireDefinition } from './retire-definition.ts';
import { defineRunDefinition } from './run-definition.ts';
import { defineUpdateDefinition } from './update-definition.ts';

export interface BrainOperation {
  readonly registration: Registration<'brain'>;
}

export function makeDefinitionOperations(
  capabilities: readonly Capability[],
  presenters?: readonly Presenter[],
): readonly BrainOperation[] {
  return [
    defineCreateDefinition(capabilities),
    defineListDefinitions(capabilities),
    defineGetDefinition(capabilities),
    defineUpdateDefinition(capabilities),
    defineRetireDefinition(capabilities),
    defineRunDefinition(capabilities),
    ...runOperations(capabilities, presenters),
  ];
}
