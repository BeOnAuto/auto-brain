import type { DispatcherServices } from '@on.auto/operations';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { ledgerStoresOpenedBy } from '../database/ledger-stores.ts';
import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess } from './served-reasoning.ts';

export function compositionRootWith(
  modelAccessOf: FunctionWiring['modelAccessOf'],
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ServerOptions<DispatcherServices> {
  const wiring = functionWiringOf(modelAccessOf, programPoolOf, toolTiming);
  return {
    ...defaultServerOptions,
    composed: (settings, telemetry) => {
      const database = ledgerDatabaseOf(settings, telemetry.appended);
      return {
        services: applicationLayer(ledgerLayerFor(settings, database, wiring.projections.appends)),
        serve: async (runtime) => {
          const { ledger, workflows, identityIssuer } = settings;
          const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
          const functions = await functionsServedBy(runtime, settings, database, { ...wiring, telemetry });
          const parts = {
            ledger,
            workflows,
            identityIssuer,
            ...functions.parts,
            ...(clock === undefined ? {} : { clock }),
          };
          return stores.withSecretsClosed(functions.closing(await serveWorkflows(runtime, parts)));
        },
      };
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
