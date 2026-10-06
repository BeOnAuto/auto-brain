import type { AppRuntime } from '@beonauto/api';
import { makeCatalog, makeDispatcher, type DispatcherServices, type Registration } from '@beonauto/operations';
import { defineSendExecutionEvent, makeWorkflowAdapter, runPresenter } from '@beonauto/orchestration';
import type { Primitive } from '@beonauto/specs';

import { brainOperationsServing } from '../composition/brain-operations.ts';
import { routesFor } from '../composition/served-routes.ts';
import type { Served } from '../lifecycle/lifecycle.ts';
import { openedHost, type HostParts } from './host-dependencies.ts';

const callMarginMs = 60_000;

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export interface WorkflowParts extends HostParts {
  readonly orgOperations: readonly OrgOperation[];
}

export function longestCallOf(primitives: readonly Pick<Primitive, 'longestExecutionMs'>[]): number {
  return Math.max(0, ...primitives.map(({ longestExecutionMs }) => longestExecutionMs)) + callMarginMs;
}

export async function serveWorkflows(runtime: AppRuntime<DispatcherServices>, parts: WorkflowParts): Promise<Served> {
  const dispatcher = makeDispatcher([]);
  const host = await openedHost(runtime, dispatcher, parts);
  const workflow = makeWorkflowAdapter({
    runs: host,
    mostDurationMs: parts.workflows.mostDurationMs,
    longestCallMs: longestCallOf(parts.primitives),
  });
  const catalog = makeCatalog([
    ...parts.orgOperations,
    ...brainOperationsServing([...parts.primitives, workflow], [runPresenter]),
    defineSendExecutionEvent(host),
  ]);
  return { routes: routesFor(runtime, catalog, dispatcher), stopWork: host.stop };
}
