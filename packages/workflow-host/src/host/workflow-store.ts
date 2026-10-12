import type { HostDatabase } from '../database/host-database.ts';
import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';
import { tablesOf, type SomeFolder } from '../projector/folder.ts';
import { viewsPortOn, type ViewsPort } from '../views/views-port.ts';

export interface WorkflowStore {
  readonly views: ViewsPort;
  readonly database: HostDatabase;
}

export async function openWorkflowStore(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
  folders: readonly SomeFolder[],
): Promise<WorkflowStore> {
  const database = await openHostDatabase(settings, reportLostConnection, tablesOf(folders));
  return { views: viewsPortOn(database), database };
}

export type StoreSettings = DatabaseSettings | WorkflowStore;

function isWorkflowStore(database: StoreSettings): database is WorkflowStore {
  return 'views' in database;
}

export function storeOf(
  database: StoreSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
  folders: readonly SomeFolder[],
): Promise<WorkflowStore> {
  return isWorkflowStore(database)
    ? Promise.resolve(database)
    : openWorkflowStore(database, reportLostConnection, folders);
}
