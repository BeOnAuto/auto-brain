import type { AppRuntime } from '@on.auto/api';
import { callMarginMs, defineSendRunEvent, makeWorkflowAdapter, type ExpressionCheck } from '@on.auto/coordination';
import {
  defineStartVersion,
  type PlaybookOperation,
  type PlaybookOwnNames,
  type Capability,
  type CapabilityFacts,
} from '@on.auto/definitions';
import {
  makeCatalog,
  makeDispatcher,
  type DispatcherServices,
  type HttpRegistration,
  type Registration,
} from '@on.auto/operations';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { playbookOperationsServing } from '../composition/playbook-operations.ts';
import { routesFor } from '../composition/served-routes.ts';
import type { Served } from '../lifecycle/lifecycle.ts';
import { openedHost, type HostParts } from './host-dependencies.ts';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

interface PlaybookRoute {
  readonly registration: HttpRegistration<'playbook'>;
}

export interface WorkflowParts extends HostParts {
  readonly orgOperations: readonly OrgOperation[];
  readonly playbookOperations: readonly PlaybookOperation[];
  readonly playbookRoutes: readonly PlaybookRoute[];
  readonly check: ExpressionCheck;
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly identityIssuer: string;
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
    ...playbookOperationsServing(capabilities, parts),
    ...parts.playbookOperations,
    ...parts.playbookRoutes,
    defineSendRunEvent(host, names),
  ]);
  const served = { catalog, dispatcher, capabilities, identityIssuer: parts.identityIssuer };
  return { routes: routesFor(runtime, served), stopWork: host.stop };
}
