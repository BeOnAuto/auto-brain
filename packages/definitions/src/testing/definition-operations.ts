import type { Presenter } from '@beonauto/operations';

import {
  defineCancelRun,
  defineCreateDefinition,
  defineRunDefinition,
  defineGetRunHistory,
  defineGetDefinition,
  defineListRuns,
  defineListDefinitions,
  defineRetireDefinition,
  defineUpdateDefinition,
  getRun,
  makeDefinitionPresenters,
  type Capability,
} from '../index.ts';

export function definitionOperationsFor(
  capabilities: readonly Capability[],
  presenters: readonly Presenter[] = makeDefinitionPresenters(capabilities),
) {
  return {
    createDefinition: defineCreateDefinition(capabilities),
    listDefinitions: defineListDefinitions(capabilities),
    getDefinition: defineGetDefinition(capabilities),
    updateDefinition: defineUpdateDefinition(capabilities),
    retireDefinition: defineRetireDefinition(capabilities),
    runDefinition: defineRunDefinition(capabilities),
    getRun,
    cancelRun: defineCancelRun(capabilities),
    listRuns: defineListRuns(capabilities),
    getRunHistory: defineGetRunHistory(presenters),
  };
}
