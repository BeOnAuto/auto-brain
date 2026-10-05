import type { FetchLike } from '@modelcontextprotocol/client';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { McpServerSettings } from '../settings/mcp-settings.ts';
import { openHttp } from './http-connection.ts';
import { ignored } from './ignored.ts';
import type { McpConnection } from './mcp-connection.ts';
import { openStdio } from './stdio-connection.ts';
import { tokenSource } from './token-source.ts';

export interface ServerLink {
  readonly settings: McpServerSettings;
  readonly take: () => Promise<McpConnection>;
  readonly renew: (failed: McpConnection) => Promise<McpConnection>;
  readonly release: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface LinkOptions {
  readonly fetch: FetchLike;
  readonly secrets: Secrets;
  readonly now: () => number;
  readonly timing: Timing;
  readonly reportOutput: (server: string, line: string) => void;
}

function opener(settings: McpServerSettings, options: LinkOptions): () => Promise<McpConnection> {
  if (settings.type === 'stdio') {
    return () =>
      openStdio(settings, {
        timeoutMs: options.timing.openMs,
        output: {
          scrub: options.secrets.scrub,
          report: (line) => {
            options.reportOutput(settings.name, line);
          },
        },
      });
  }
  const authProvider =
    settings.auth === null
      ? undefined
      : tokenSource(settings.auth, {
          serverUrl: settings.url,
          fetch: options.fetch,
          now: options.now,
          minted: options.secrets.add,
        });
  const { openMs, longestRetryWaitMs } = options.timing;
  return () => openHttp(settings, { fetch: options.fetch, authProvider, timeoutMs: openMs, longestRetryWaitMs });
}

function endOf(connection: Promise<McpConnection> | undefined): Promise<void> | undefined {
  return connection?.then((opened) => opened.end(), ignored);
}

interface HeldConnection {
  readonly using: () => Promise<McpConnection>;
  readonly forgotten: () => Promise<McpConnection> | undefined;
  readonly isLatest: (connection: McpConnection) => boolean;
}

function heldConnection(open: () => Promise<McpConnection>): HeldConnection {
  let current: Promise<McpConnection> | undefined;
  let latest: McpConnection | undefined;
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

async function usedOrForgotten(held: HeldConnection): Promise<McpConnection> {
  try {
    return await held.using();
  } catch (failure) {
    void held.forgotten();
    throw failure;
  }
}

export function serverLink(settings: McpServerSettings, options: LinkOptions): ServerLink {
  const held = heldConnection(opener(settings, options));
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
      if (holders === 0 && settings.type === 'http') {
        await endOf(held.forgotten());
      }
    },
    stop: async () => {
      await endOf(held.forgotten());
    },
  };
}
