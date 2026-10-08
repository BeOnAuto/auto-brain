import { Effect } from 'effect';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOfServers } from '../bounds/secrets.ts';
import { serverLink, type LinkOptions } from '../connections/server-links.ts';
import { deliveredCall } from '../delivery/delivery-call.ts';
import type { McpSettings } from '../settings/mcp-settings.ts';
import { openedRun } from './run-opening.ts';
import type { LinkedAccess, ToolAccessOptions } from './tool-access.ts';
import { toolServersOf } from './tool-servers.ts';

export function linkedAccess(settings: McpSettings, options: ToolAccessOptions): LinkedAccess {
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
    testing: { allowed: settings.allowed, testable: settings.testable },
    open: (context, references) =>
      openedRun({ context, references, links, allowed: settings.allowed, secrets, timing, report }),
    callOnce: (call) => deliveredCall(call, { links, allowed: settings.allowed, secrets, timing }),
    listServers: (scope, named) =>
      Effect.promise(() =>
        toolServersOf(
          { scope, named },
          { links, allowed: settings.allowed, testable: settings.testable, secrets, timing },
        ),
      ),
    close: async () => {
      await Promise.all([...links.values()].map((link) => link.stop()));
    },
  };
}
