import type { HttpRegistration, Registration } from '@on.auto/operations';

import { defineGiveCredential } from '../page/give-credential.ts';
import { defineApprove, readLink } from '../page/link-operations.ts';
import { defineAddConnection } from './add-connection.ts';
import type { ConnectionServices } from './connection-services.ts';
import { getConnection, listConnections } from './read-connections.ts';
import { defineRemoveConnection } from './remove-connection.ts';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

interface OrgRoute {
  readonly registration: HttpRegistration<'org'>;
}

export interface ConnectionOperations {
  readonly operations: readonly OrgOperation[];
  readonly pageRoutes: readonly OrgRoute[];
}

export function makeConnectionOperations(services: ConnectionServices): ConnectionOperations {
  return {
    operations: [defineAddConnection(services), listConnections, getConnection, defineRemoveConnection(services)],
    pageRoutes: [readLink, defineApprove(services), defineGiveCredential(services)],
  };
}
