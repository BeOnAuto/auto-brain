import type { AppRuntime } from '@beonauto/api';
import { eventEmitter, type BrainOperation } from '@beonauto/definitions';
import {
  brainCallerOf,
  Ledger,
  type BrainRequest,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
} from '@beonauto/operations';
import { StartRefused, StartRejected, type ReactionOptions, type ReactionStart } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';

const workflows = 'workflow';

function requestOf({
  org,
  brain,
  workflow,
  version,
  input,
  runId,
  depth,
  cause,
  trigger,
}: ReactionStart): BrainRequest {
  return {
    caller: brainCallerOf({ org, brain }),
    org,
    brain,
    input: { type: workflows, name: workflow, version, input, run_id: runId },
    encoding: 'json',
    lineage: { causationId: cause, correlationId: runId },
    depth,
    trigger,
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
    definitionType: workflows,
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
