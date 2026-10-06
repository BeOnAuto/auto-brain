import type { McpConnection } from '../connections/mcp-connection.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { McpServerSettings } from '../settings/mcp-settings.ts';

type Restart = 'running' | 'restarted' | 'exited_again';

export interface ServerSlot {
  readonly settings: McpServerSettings;
  readonly connection: () => McpConnection;
  readonly reopenOnce: () => Promise<boolean>;
  readonly restartIfExited: () => Promise<Restart>;
  readonly release: () => Promise<void>;
}

export function serverSlot(link: ServerLink, first: McpConnection): ServerSlot {
  let current = first;
  let exited = false;
  let reopened = false;
  let restarted = false;
  const watched = (connection: McpConnection): McpConnection => {
    void connection.closed.then(() => {
      exited = exited || current === connection;
      return exited;
    });
    return connection;
  };
  const renewed = async (): Promise<void> => {
    current = watched(await link.renew(current));
    exited = false;
  };
  watched(first);
  return {
    settings: link.settings,
    connection: () => current,
    reopenOnce: async () => {
      if (reopened) {
        return false;
      }
      reopened = true;
      await renewed();
      return true;
    },
    restartIfExited: async () => {
      if (!exited) {
        return 'running';
      }
      if (restarted) {
        return 'exited_again';
      }
      restarted = true;
      await renewed();
      return 'restarted';
    },
    release: () => link.release(),
  };
}
