import type { RouteRegistration } from '@on.auto/operations';

import { defineGiveCredential } from '../page/give-credential.ts';
import { defineApprove, readLink } from '../page/link-operations.ts';
import { bindsPerson } from '../policy/policy-rules.ts';
import { defineAddConnection } from './add-connection.ts';
import type { ConnectionServices } from './connection-services.ts';
import { getConnection, listConnections } from './read-connections.ts';
import { defineRemoveConnection } from './remove-connection.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export type ConnectionOperations = readonly OrgOperation[];

export function makeConnectionOperations(services: ConnectionServices): ConnectionOperations {
  const binding = { bindsPerson: bindsPerson(services.access) };
  return [
    defineAddConnection(services),
    listConnections,
    getConnection,
    defineRemoveConnection(services),
    readLink,
    defineApprove(binding),
    defineGiveCredential({ ...services, ...binding }),
  ];
}
