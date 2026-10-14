import type { LinkedServerSettings } from '../openapi/described-api.ts';
import { ignored } from './ignored.ts';
import { openerOf, type LinkOptions } from './link-openers.ts';
import type { ServerConnection } from './server-connection.ts';

export interface ServerLink {
  readonly settings: LinkedServerSettings;
  readonly take: () => Promise<ServerConnection>;
  readonly renew: (failed: ServerConnection) => Promise<ServerConnection>;
  readonly release: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

function endOf(connection: Promise<ServerConnection> | undefined): Promise<void> | undefined {
  return connection?.then((opened) => opened.end(), ignored);
}

interface HeldConnection {
  readonly using: () => Promise<ServerConnection>;
  readonly forgotten: () => Promise<ServerConnection> | undefined;
  readonly isLatest: (connection: ServerConnection) => boolean;
}

function heldConnection(open: () => Promise<ServerConnection>): HeldConnection {
  let current: Promise<ServerConnection> | undefined;
  let latest: ServerConnection | undefined;
  return {
    using: () => {
      current ??= open().then((opened) => {
        latest = opened;
        return opened;
      });
      return current;
    },
    forgotten: () => {
      const forgetting = current;
      current = undefined;
      latest = undefined;
      return forgetting;
    },
    isLatest: (connection) => latest === connection,
  };
}

async function usedOrForgotten(held: HeldConnection): Promise<ServerConnection> {
  try {
    return await held.using();
  } catch (failure) {
    void held.forgotten();
    throw failure;
  }
}

export function serverLink(settings: LinkedServerSettings, options: LinkOptions): ServerLink {
  const held = heldConnection(openerOf(settings, options));
  let holders = 0;
  return {
    settings,
    take: async () => {
      holders += 1;
      try {
        return await usedOrForgotten(held);
      } catch (failure) {
        holders -= 1;
        throw failure;
      }
    },
    renew: (failed) => {
      if (held.isLatest(failed)) {
        void endOf(held.forgotten());
      }
      return usedOrForgotten(held);
    },
    release: async () => {
      holders -= 1;
      if (holders === 0 && settings.type === 'mcp') {
        await endOf(held.forgotten());
      }
    },
    stop: async () => {
      await endOf(held.forgotten());
    },
  };
}
