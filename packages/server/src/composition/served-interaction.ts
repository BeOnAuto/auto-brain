import type { AppRuntime } from '@beonauto/api';
import {
  answerInteraction,
  listInteractions,
  makeInteractionFunctionAdapter,
  openRequestsName,
  requestsDue,
  type RequestsDue,
} from '@beonauto/interaction';
import type { ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';
import type { BrainOperation, Primitive } from '@beonauto/specs';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ServedInteraction {
  readonly primitive: Primitive;
  readonly operations: readonly BrainOperation[];
  readonly dueWork: RequestsDue;
}

export function interactionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { interaction }: Pick<Settings, 'interaction'>,
  tools: Pick<ToolAccess, 'named' | 'configured' | 'startOf' | 'callOnce'>,
): ServedInteraction {
  const ledger = runtimeLedger(runtime);
  return {
    primitive: makeInteractionFunctionAdapter({
      tools,
      openRequests: (brain) => ledger.countProjectedRows(openRequestsName, brain, [{ column: 'open', equals: true }]),
      mostOpenRequests: interaction.mostOpenRequests,
    }),
    operations: [answerInteraction, listInteractions],
    dueWork: requestsDue({ ledger, tools }),
  };
}
