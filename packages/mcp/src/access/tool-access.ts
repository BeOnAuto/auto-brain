import type { Effect } from 'effect';

import { defaultTiming, type Timing } from '../bounds/call-bounds.ts';
import { secretsOfServers } from '../bounds/secrets.ts';
import { routeClientConsole } from '../connections/console-routing.ts';
import { serverLink, type LinkOptions } from '../connections/server-links.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { McpSettings } from '../settings/mcp-settings.ts';
import type { RunContext, ServerMessage, ToolsNotOpened } from './run-context.ts';
import { openedRun } from './run-opening.ts';
import type { RunTools } from './run-tools.ts';

export interface ToolAccessOptions {
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: Timing;
}

export interface ToolAccess {
  readonly configured: boolean;
  readonly open: (
    execution: RunContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly close: () => Promise<void>;
}

export function makeToolAccess(settings: McpSettings, options: ToolAccessOptions): ToolAccess {
  const report = options.reportServerMessage;
  const timing = options.timing ?? defaultTiming;
  const secrets = secretsOfServers(settings.servers);
  const linkOptions: LinkOptions = {
    fetch: options.fetch ?? globalThis.fetch,
    secrets,
    now: options.now ?? Date.now,
    timing,
    reportOutput: (server, message) => {
      report({ server, message, execution_id: null });
    },
  };
  const links = new Map(settings.servers.map((server) => [server.name, serverLink(server, linkOptions)]));
  const restoreConsole = routeClientConsole((message) => {
    report({ server: 'the MCP client', message: secrets.scrub(message), execution_id: null });
  });
  return {
    configured: settings.servers.length > 0,
    open: (execution, references) =>
      openedRun({ execution, references, links, allowed: settings.allowed, secrets, timing, report }),
    close: async () => {
      restoreConsole();
      await Promise.all([...links.values()].map((link) => link.stop()));
    },
  };
}
