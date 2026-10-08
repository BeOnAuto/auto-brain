import { mcpRoutes, operationRoutes, type AppRuntime, type RegisterRoutes } from '@beonauto/api';
import {
  makeCatalog,
  makeDispatcher,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
} from '@beonauto/operations';
import type { Primitive } from '@beonauto/specs';

import { servedGuidesOf } from '../guides/served-guides.ts';
import { logMcpError } from '../logging/logging.ts';
import { release } from './release.ts';

type Operations = Parameters<typeof makeCatalog>[0];

export function routesFor(
  runtime: AppRuntime<DispatcherServices>,
  catalog: Catalog,
  dispatcher: Dispatcher,
  primitives: readonly Primitive[],
): readonly RegisterRoutes[] {
  return [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: release,
      ...servedGuidesOf(primitives),
      reportError: (error) => {
        void runtime.run(logMcpError(error));
      },
    }),
  ];
}

export function routesServing(
  operations: Operations,
): (runtime: AppRuntime<DispatcherServices>) => readonly RegisterRoutes[] {
  return (runtime) => routesFor(runtime, makeCatalog(operations), makeDispatcher([]), []);
}
