import { Effect } from 'effect';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOfServers } from '../bounds/secrets.ts';
import { serverLink, type LinkOptions } from '../connections/server-links.ts';
import { deliveredCall } from '../delivery/delivery-call.ts';
import type { McpSettings } from '../settings/mcp-settings.ts';
import { openedRun } from './run-opening.ts';
import type { ToolAccess, ToolAccessOptions } from './tool-access.ts';
import { toolServersOf } from './tool-servers.ts';

export function linkedAccess(settings: McpSettings, options: ToolAccessOptions): ToolAccess {
  const report = options.reportServerMessage;
  const timing = options.timing ?? defaultTiming;
  const secrets = secretsOfServers(settings.servers);
  const linkOptions: LinkOptions = {
    fetch: options.fetch ?? globalThis.fetch,
    secrets,
    now: options.now ?? Date.now,
    timing,
    reportOutput: (server, message) => {
      report({ server, message, execution_id: null, tool_test_id: null });
    },
  };
  const links = new Map(settings.servers.map((server) => [server.name, serverLink(server, linkOptions)]));
  return {
    configured: settings.servers.length > 0,
    open: (context, references) =>
      openedRun({ context, references, links, allowed: settings.allowed, secrets, timing, report }),
    callOnce: (call) => deliveredCall(call, { links, allowed: settings.allowed, secrets, timing }),
    listServers: (address, named) =>
      Effect.promise(() => toolServersOf({ address, named }, { links, allowed: settings.allowed, secrets, timing })),
    close: async () => {
      await Promise.all([...links.values()].map((link) => link.stop()));
    },
  };
}
