import type { HostDatabase } from '../database/host-database.ts';
import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';
import { viewsPortOn, type ViewsPort } from '../views/views-port.ts';

export interface WorkflowStore {
  readonly views: ViewsPort;
  readonly database: HostDatabase;
}

export async function openWorkflowStore(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
): Promise<WorkflowStore> {
  const database = await openHostDatabase(settings, reportLostConnection);
  return { views: viewsPortOn(database), database };
}

export type StoreSettings = DatabaseSettings | WorkflowStore;

function isWorkflowStore(database: StoreSettings): database is WorkflowStore {
  return 'views' in database;
}

export function storeOf(
  database: StoreSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
): Promise<WorkflowStore> {
  return isWorkflowStore(database) ? Promise.resolve(database) : openWorkflowStore(database, reportLostConnection);
}
