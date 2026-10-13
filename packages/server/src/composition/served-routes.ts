import {
  apiCatalogRoutes,
  guideRoutes,
  guideShelfOf,
  mcpRoutes,
  openApiDocumentRoutes,
  operationRoutes,
  type AppRuntime,
  type RegisterRoutes,
} from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import {
  makeCatalog,
  makeDispatcher,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
} from '@on.auto/operations';

import { servedGuidesOf } from '../guides/served-guides.ts';
import { logMcpError } from '../logging/logging.ts';
import { release } from './release.ts';

type Operations = Parameters<typeof makeCatalog>[0];

export function routesFor(
  runtime: AppRuntime<DispatcherServices>,
  catalog: Catalog,
  dispatcher: Dispatcher,
  capabilities: readonly Capability[],
): readonly RegisterRoutes[] {
  const { guides, recipes, definitionTypes } = servedGuidesOf(capabilities);
  const shelf = guideShelfOf(guides, recipes, definitionTypes);
  return [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiDocumentRoutes({ catalog, serverInfo: release, shelf }),
    guideRoutes(shelf),
    apiCatalogRoutes(shelf),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: release,
      shelf,
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
