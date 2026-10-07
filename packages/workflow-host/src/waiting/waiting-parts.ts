import type { MachineOptions } from '@beonauto/workflow-engine';
import type { Effect } from 'effect';

import type { ExecutorParts } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import type { CallConsumer, DeliveryFailed } from '../follower/consumers.ts';
import { cancelRequests, type CancelParts } from './cancel-requests.ts';
import { childCancelsOn } from './child-cancels.ts';
import { childAnswersOn, childEndings, endedChildrenOn, type EndingParts } from './child-endings.ts';
import { mostOpenCallsOfATree, type WaitingOptions } from './waiting-options.ts';

export type ExecutorWaiting = Pick<ExecutorParts, 'mostOpen' | 'childOf' | 'childAnswerOf' | 'cancelChild'>;

export function executorWaitingOf(
  database: HostDatabase,
  machine: MachineOptions,
  waiting: WaitingOptions,
  mostOpen: number = mostOpenCallsOfATree,
): ExecutorWaiting {
  return {
    mostOpen,
    childAnswerOf: childAnswersOn(database, waiting.resultOf),
    childOf: (call, run) =>
      machine.functions.childOf?.({
        function: call.function,
        reference: call.key.reference,
        run: call.key.run,
        arguments: call.arguments,
        attributes: run.attributes,
      }) ?? null,
    cancelChild: childCancelsOn(waiting.cancel),
  };
}

export type CallConsumerParts = EndingParts & CancelParts;

export interface ServedWaiting {
  readonly calls: readonly CallConsumer[];
  readonly endedChildren: (runId: string) => Effect.Effect<void, DeliveryFailed>;
}

export function servedWaitingOf(parts: CallConsumerParts): ServedWaiting {
  return { calls: [childEndings(parts), cancelRequests(parts)], endedChildren: endedChildrenOn(parts) };
}
