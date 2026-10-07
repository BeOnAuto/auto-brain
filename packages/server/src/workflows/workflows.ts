import type { AppRuntime } from '@beonauto/api';
import { makeCatalog, makeDispatcher, type DispatcherServices, type Registration } from '@beonauto/operations';
import { callMarginMs, defineSendExecutionEvent, makeWorkflowAdapter, runPresenter } from '@beonauto/orchestration';
import { defineStartVersion, type Primitive } from '@beonauto/specs';
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
}

export function longestCallOf(primitives: readonly Pick<Primitive, 'longestExecutionMs'>[]): number {
  return Math.max(0, ...primitives.map(({ longestExecutionMs }) => longestExecutionMs)) + callMarginMs;
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
  const workflow = makeWorkflowAdapter({
    runs: onceOpened(opening.promise),
    mostDurationMs: parts.workflows.mostDurationMs,
    longestCallMs: longestCallOf(parts.primitives),
  });
  const primitives = [...parts.primitives, workflow];
  const host = await openedHost(runtime, dispatcher, { ...parts, primitives }, defineStartVersion(primitives));
  opening.resolve(host);
  const catalog = makeCatalog([
    ...parts.orgOperations,
    ...brainOperationsServing(primitives, [runPresenter]),
    defineSendExecutionEvent(host),
  ]);
  const definitionTypes = primitives.map(({ name, noun }) => ({ primitive: name, noun: noun.one }));
  return { routes: routesFor(runtime, catalog, dispatcher, definitionTypes), stopWork: host.stop };
}
