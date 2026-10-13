import { authenticatorFor, createApiKey, type Authenticator } from '@on.auto/identity';
import { allPermissions, makeCatalog, makeDispatcher, type DispatcherServices } from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { Layer } from 'effect';

import {
  makeAppRuntime,
  mcpRoutes,
  openApiRoutes,
  operationRoutes,
  type ApiHandler,
  type AppRuntime,
} from '../index.ts';
import { createTestHandler, type ReportedThrown } from './api-calls.ts';
import { testDefinitionTypes, testGuides, testRecipes } from './guides.ts';
import { notebookOperations } from './notebook.ts';

export interface OperationServer {
  readonly handler: ApiHandler;
  readonly runtime: AppRuntime<DispatcherServices>;
  readonly incidents: () => readonly ReportedIncident[];
  readonly thrown: () => readonly ReportedThrown[];
  readonly mcpErrors: () => readonly string[];
}

export const testServerInfo = { name: '@on.auto/runtime', version: '0.0.0-test' };

const knownPlaybooks = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

export const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

export const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

export const acmeAlphaWriter = createApiKey({
  id: 'acme-alpha-writer',
  org: 'acme',
  permissions: allPermissions,
  playbooks: ['alpha'],
});

export const globexAdmin = createApiKey({
  id: 'globex-admin',
  org: 'globex',
  permissions: allPermissions,
  playbooks: '*',
});

const keyHolders = authenticatorFor({
  host: '0.0.0.0',
  apiKeys: [acmeAdmin.entry, acmeReader.entry, acmeAlphaWriter.entry, globexAdmin.entry],
  localMode: false,
});

export interface OperationServerOptions {
  readonly authenticator?: Authenticator;
  readonly allowedOrigins?: readonly string[];
  readonly operations?: Parameters<typeof makeCatalog>[0];
}

export async function operationServer({
  authenticator = keyHolders,
  allowedOrigins = [],
  operations = notebookOperations,
}: OperationServerOptions = {}): Promise<OperationServer> {
  const ledger = memoryLedger();
  const recording = recordingReporter();
  const runtime = await makeAppRuntime(
    Layer.mergeAll(ledger.layer, memoryPlaybookRegistry(knownPlaybooks), recording.layer),
  );
  const catalog = makeCatalog(operations);
  const dispatcher = makeDispatcher([]);
  const mcpErrors: string[] = [];
  const guides = { definitionTypes: testDefinitionTypes, guides: testGuides, recipes: testRecipes };
  const routes = [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiRoutes({ catalog, serverInfo: testServerInfo, ...guides }),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: testServerInfo,
      ...guides,
      reportError: (error) => {
        mcpErrors.push(error.message);
      },
    }),
  ];
  const { handler, reported } = createTestHandler({ authenticator, allowedOrigins, routes });
  return {
    handler,
    runtime,
    incidents: recording.reported,
    thrown: () => [...reported],
    mcpErrors: () => [...mcpErrors],
  };
}
