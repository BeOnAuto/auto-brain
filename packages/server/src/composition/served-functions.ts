import type { AppRuntime } from '@beonauto/api';
import { brainOperations } from '@beonauto/brains';
import type { DispatcherServices } from '@beonauto/operations';

import type { Served } from '../lifecycle/lifecycle.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { FunctionWiring } from './function-wiring.ts';
import { computationServedBy } from './served-computation.ts';
import { toolUsersServedBy } from './served-tools.ts';

export interface ServedFunctions {
  readonly parts: Omit<WorkflowParts, 'ledger' | 'workflows'>;
  readonly closing: (served: Served) => Served;
}

export async function functionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { modelAccessOf, programPoolOf, recall: wiring, toolTiming }: FunctionWiring,
): Promise<ServedFunctions> {
  const { reasoning, interaction, withToolsClosed } = await toolUsersServedBy(
    runtime,
    settings,
    modelAccessOf,
    toolTiming,
  );
  const computation = await computationServedBy(settings.computation, programPoolOf);
  const recall = await wiring.served(runtime, settings, computation.pool);
  const capabilities = [reasoning.capability, interaction.capability, computation.capability, recall.capability];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  return {
    parts: {
      capabilities,
      facts,
      names,
      orgOperations: [...brainOperations, reasoning.listModels, reasoning.listToolServersInOrg],
      brainOperations: [reasoning.listToolServers, reasoning.testToolCall, ...interaction.operations],
      dueWork: interaction.dueWorkOf(record),
      store: recall.store,
      views: recall.views,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
    closing: (served) => computation.withPoolClosed(withToolsClosed(served)),
  };
}
