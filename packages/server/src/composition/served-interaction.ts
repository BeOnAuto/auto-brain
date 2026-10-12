import type { AppRuntime } from '@beonauto/api';
import type { PlaybookOperation, Capability } from '@beonauto/definitions';
import {
  answerInteraction,
  conversationsDue,
  listInteractions,
  makeInteractionFunctionAdapter,
  openRequestsName,
  requestsDue,
  type RequestsDue,
} from '@beonauto/interaction';
import type { ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ServedInteraction {
  readonly capability: Capability;
  readonly operations: readonly PlaybookOperation[];
  readonly dueWork: readonly RequestsDue[];
}

export function interactionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { interaction }: Pick<Settings, 'interaction'>,
  tools: Pick<ToolAccess, 'named' | 'configured' | 'startOf' | 'callOnce'>,
): ServedInteraction {
  const ledger = runtimeLedger(runtime);
  return {
    capability: makeInteractionFunctionAdapter({
      tools,
      openRequests: (playbook) =>
        ledger.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
      mostOpenRequests: interaction.mostOpenRequests,
    }),
    operations: [answerInteraction, listInteractions],
    dueWork: [requestsDue({ ledger, tools }), conversationsDue({ ledger, tools })],
  };
}
