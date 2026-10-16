import type { Environment } from '@on.auto/config';
import { readConnectionPolicy, type ConnectionPolicy } from '@on.auto/connections';
import { Effect } from 'effect';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
}

export function readConnectionSettings(environment: Environment): ConnectionSettings {
  return { connections: Effect.runSync(readConnectionPolicy(environment)) };
}
