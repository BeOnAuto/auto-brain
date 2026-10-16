import { Effect } from 'effect';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { serverLink } from '../connections/server-links.ts';
import { oneCall } from '../one-call/one-call.ts';
import type { ToolServers } from '../openapi/described-api.ts';
import { openedRun } from './run-opening.ts';
import type { LinkedAccess, LinkedOptions } from './tool-access.ts';
import { toolServersOf } from './tool-servers.ts';

export function linkedAccess(settings: ToolServers, options: LinkedOptions): LinkedAccess {
  const report = options.reportServerMessage;
  const timing = options.timing ?? defaultTiming;
  const { secrets } = options;
  const linkOptions = {
    client: options.client,
    fetch: options.fetch ?? globalThis.fetch,
    secrets,
    now: options.now ?? Date.now,
    timing,
    reportOutput: (server: string, message: string) => {
      report({ server, message, run_id: null, call_id: null });
    },
    ...(options.traceMeta === undefined ? {} : { traceMeta: options.traceMeta }),
  };
  const links = new Map(settings.servers.map((server) => [server.name, serverLink(server, linkOptions)]));
  return {
    configured: settings.servers.length > 0,
    open: (context, references) =>
      openedRun({ context, references, links, secrets, keepIn: options.keepIn, timing, report }),
    callOnce: (call, runCall) => oneCall(call, { links, secrets, keepIn: options.keepIn, timing }, runCall),
    listServers: (scope, named) => Effect.promise(() => toolServersOf({ scope, named }, { links, secrets, timing })),
    close: async () => {
      await Promise.all([...links.values()].map((link) => link.stop()));
    },
  };
}
