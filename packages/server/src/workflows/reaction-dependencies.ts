import type { AppRuntime } from '@beonauto/api';
import {
  brainCallerOf,
  Ledger,
  type BrainRequest,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
} from '@beonauto/operations';
import { triggerOfSource } from '@beonauto/orchestration';
import { eventEmitter, type BrainOperation } from '@beonauto/specs';
import { StartRefused, StartRejected, type ReactionOptions, type ReactionStart } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';

const workflows = 'orchestration';

function requestOf({ org, brain, workflow, version, input, executionId, depth, cause }: ReactionStart): BrainRequest {
  return {
    caller: brainCallerOf({ org, brain }),
    org,
    brain,
    input: { primitive: workflows, name: workflow, version, input, execution_id: executionId },
    encoding: 'json',
    lineage: { causationId: cause, correlationId: executionId },
    depth,
  };
}

function startAnswered(outcome: Outcome): Effect.Effect<void, StartRefused | StartRejected> {
  if (outcome.status === 'succeeded') {
    return Effect.void;
  }
  if (outcome.status === 'failed') {
    return Effect.fail(new StartRefused({ detail: `The start failed with incident ${outcome.incident}` }));
  }
  return outcome.reason === 'unavailable'
    ? Effect.fail(new StartRefused({ detail: outcome.detail }))
    : Effect.fail(new StartRejected({ detail: outcome.detail }));
}

export function reactionsOf(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  startVersion: BrainOperation,
): ReactionOptions {
  return {
    primitive: workflows,
    triggerOf: triggerOfSource,
    start: (start) =>
      Effect.flatMap(
        inRuntime(runtime, dispatcher.dispatchToBrain(startVersion.registration, requestOf(start))),
        startAnswered,
      ),
    emit: (brain, emission, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => eventEmitter(ledger)(brain, emission, lineage)),
      ),
  };
}
