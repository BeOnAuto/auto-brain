import {
  apiCatalogRoutes,
  guideRoutes,
  guideShelfOf,
  mcpRoutes,
  openApiDocumentRoutes,
  operationRoutes,
  type AppRuntime,
  type RegisterRoutes,
  type RetryStateKeys,
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

export interface ServedCatalog {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly capabilities: readonly Capability[];
  readonly identityIssuer: string;
  readonly retryStateKeys: RetryStateKeys;
}

export function routesFor(
  runtime: AppRuntime<DispatcherServices>,
  { catalog, dispatcher, capabilities, identityIssuer, retryStateKeys }: ServedCatalog,
): readonly RegisterRoutes[] {
  const { guides, recipes, definitionTypes } = servedGuidesOf(capabilities);
  const shelf = guideShelfOf(guides, recipes, definitionTypes);
  return [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiDocumentRoutes({ catalog, serverInfo: release, shelf, identityIssuer }),
    guideRoutes(shelf),
    apiCatalogRoutes(shelf),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: release,
      shelf,
      retryStateKeys,
      reportError: (error) => {
        void runtime.run(logMcpError(error));
      },
    }),
  ];
}

export function routesServing(
  operations: Operations,
  { identityIssuer, retryStateKeys }: Pick<ServedCatalog, 'identityIssuer' | 'retryStateKeys'>,
): (runtime: AppRuntime<DispatcherServices>) => readonly RegisterRoutes[] {
  const catalog = makeCatalog(operations);
  const served = { catalog, dispatcher: makeDispatcher([]), capabilities: [], identityIssuer, retryStateKeys };
  return (runtime) => routesFor(runtime, served);
}
