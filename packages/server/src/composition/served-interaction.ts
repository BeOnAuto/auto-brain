import type { AppRuntime } from '@beonauto/api';
import {
  defineAnswerInteraction,
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
  tools: Pick<ToolAccess, 'callOnce'>,
): ServedInteraction {
  const ledger = runtimeLedger(runtime);
  const { channels, mostOpenRequests, origin } = interaction;
  return {
    primitive: makeInteractionFunctionAdapter({
      channels,
      openRequests: (brain) => ledger.countProjectedRows(openRequestsName, brain, [{ column: 'open', equals: true }]),
      mostOpenRequests,
    }),
    operations: [defineAnswerInteraction(channels), listInteractions],
    dueWork: requestsDue({ ledger, channels, tools, origin }),
  };
}
