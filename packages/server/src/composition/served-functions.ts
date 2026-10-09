import type { AppRuntime } from '@beonauto/api';
import { brainOperations } from '@beonauto/brains';
import type { DispatcherServices } from '@beonauto/operations';

import type { Served } from '../lifecycle/lifecycle.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { computationServedBy, workerPool, type ProgramPoolOf } from './served-computation.ts';
import type { ModelAccessOf } from './served-inference.ts';
import { recallWiring, type RecallWiring } from './served-recall.ts';
import { toolUsersServedBy } from './served-tools.ts';

export interface FunctionWiring {
  readonly modelAccessOf: ModelAccessOf;
  readonly programPoolOf: ProgramPoolOf;
  readonly recall: RecallWiring;
}

export interface ServedFunctions {
  readonly parts: Omit<WorkflowParts, 'ledger' | 'workflows'>;
  readonly closing: (served: Served) => Served;
}

export function functionWiringOf(
  modelAccessOf: ModelAccessOf,
  programPoolOf: ProgramPoolOf = workerPool,
): FunctionWiring {
  return { modelAccessOf, programPoolOf, recall: recallWiring() };
}

export async function functionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { modelAccessOf, programPoolOf, recall: wiring }: FunctionWiring,
): Promise<ServedFunctions> {
  const { reasoning, interaction, withToolsClosed } = await toolUsersServedBy(runtime, settings, modelAccessOf);
  const computation = computationServedBy(settings.computation, programPoolOf);
  const recall = await wiring.served(runtime, settings, computation.pool);
  return {
    parts: {
      primitives: [reasoning.primitive, interaction.primitive, computation.primitive, recall.primitive],
      orgOperations: [...brainOperations, reasoning.listModels, reasoning.listToolServersInOrg],
      brainOperations: [reasoning.listToolServers, reasoning.testToolCall, ...interaction.operations],
      dueWork: interaction.dueWork,
      store: recall.store,
      views: recall.views,
    },
    closing: (served) => computation.withPoolClosed(withToolsClosed(served)),
  };
}
