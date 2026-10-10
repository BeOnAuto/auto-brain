import { Effect } from 'effect';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOfServers } from '../bounds/secrets.ts';
import { serverLink, type LinkOptions } from '../connections/server-links.ts';
import { oneCall } from '../one-call/one-call.ts';
import type { McpSettings } from '../settings/mcp-settings.ts';
import { untestableNoting } from '../tool-tests/testing-guard.ts';
import { openedRun } from './run-opening.ts';
import type { LinkedAccess, LinkedOptions } from './tool-access.ts';
import { toolServersOf } from './tool-servers.ts';

export function linkedAccess(settings: McpSettings, options: LinkedOptions): LinkedAccess {
  const report = options.reportServerMessage;
  const timing = options.timing ?? defaultTiming;
  const secrets = secretsOfServers(settings.servers);
  const linkOptions: LinkOptions = {
    fetch: options.fetch ?? globalThis.fetch,
    secrets,
    now: options.now ?? Date.now,
    timing,
    reportOutput: (server, message) => {
      report({ server, message, run_id: null, tool_test_id: null });
    },
  };
  const links = new Map(settings.servers.map((server) => [server.name, serverLink(server, linkOptions)]));
  const toolsListed = untestableNoting(options.reportUntestable);
  return {
    configured: settings.servers.length > 0,
    testing: settings.servers,
    open: (context, references) =>
      openedRun({ context, references, links, secrets, keepIn: options.keepIn, timing, toolsListed, report }),
    callOnce: (call, runCall) =>
      oneCall(call, { links, secrets, keepIn: options.keepIn, timing, toolsListed }, runCall),
    listServers: (scope, named) =>
      Effect.promise(() => toolServersOf({ scope, named }, { links, secrets, timing, toolsListed })),
    close: async () => {
      await Promise.all([...links.values()].map((link) => link.stop()));
    },
  };
}
