import type { AppRuntime } from '@beonauto/api';
import { callMarginMs, defineSendRunEvent, makeWorkflowAdapter, type ExpressionCheck } from '@beonauto/coordination';
import {
  defineStartVersion,
  type BrainOperation,
  type BrainOwnNames,
  type Capability,
  type CapabilityFacts,
} from '@beonauto/definitions';
import { makeCatalog, makeDispatcher, type DispatcherServices, type Registration } from '@beonauto/operations';
import type { WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { brainOperationsServing } from '../composition/brain-operations.ts';
import { routesFor } from '../composition/served-routes.ts';
import type { Served } from '../lifecycle/lifecycle.ts';
import { openedHost, type HostParts } from './host-dependencies.ts';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export interface WorkflowParts extends HostParts {
  readonly orgOperations: readonly OrgOperation[];
  readonly brainOperations: readonly BrainOperation[];
  readonly check: ExpressionCheck;
  readonly facts: CapabilityFacts;
  readonly names: BrainOwnNames;
}

export function longestCallOf(capabilities: readonly Pick<Capability, 'longestAnyRunMs'>[]): number {
  return Math.max(0, ...capabilities.map(({ longestAnyRunMs }) => longestAnyRunMs)) + callMarginMs;
}

function onceOpened(opening: Promise<WorkflowHost>): Pick<WorkflowHost, 'start'> {
  return {
    start: (run, start) =>
      Effect.flatMap(
        Effect.promise(() => opening),
        (host) => host.start(run, start),
      ),
  };
}

export async function serveWorkflows(runtime: AppRuntime<DispatcherServices>, parts: WorkflowParts): Promise<Served> {
  const dispatcher = makeDispatcher([]);
  const opening = Promise.withResolvers<WorkflowHost>();
  const { names } = parts;
  const workflow = makeWorkflowAdapter({
    runs: onceOpened(opening.promise),
    check: parts.check,
    mostDurationMs: parts.workflows.mostDurationMs,
    longestCallMs: longestCallOf(parts.capabilities),
    names,
  });
  const capabilities = [...parts.capabilities, workflow];
  const host = await openedHost(
    runtime,
    dispatcher,
    { ...parts, capabilities },
    { startVersion: defineStartVersion(capabilities), names },
  );
  opening.resolve(host);
  const catalog = makeCatalog([
    ...parts.orgOperations,
    ...brainOperationsServing(capabilities, parts),
    ...parts.brainOperations,
    defineSendRunEvent(host, names),
  ]);
  return { routes: routesFor(runtime, catalog, dispatcher, capabilities), stopWork: host.stop };
}
