import { Effect } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import { makeToolAccess, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import { readMcpSettings, type Environment } from '../settings/settings-reading.ts';

export interface AccessOptions {
  readonly allowed?: readonly string[];
  readonly testable?: readonly string[];
  readonly environment?: Environment;
  readonly timing?: Timing;
  readonly fetch?: ToolAccessOptions['fetch'];
}

export interface ReportingAccess {
  readonly access: ToolAccess;
  readonly messages: () => readonly ServerMessage[];
}

export function reportingAccess(
  servers: Readonly<Record<string, unknown>>,
  { allowed, testable, environment = {}, timing, fetch }: AccessOptions = {},
): ReportingAccess {
  const messages: ServerMessage[] = [];
  const settings = Effect.runSync(
    readMcpSettings(
      {
        ...environment,
        MCP_SERVERS: JSON.stringify(servers),
        ...(allowed === undefined ? {} : { ALLOWED_TOOLS: JSON.stringify(allowed) }),
        ...(testable === undefined ? {} : { TESTABLE_TOOLS: JSON.stringify(testable) }),
      },
      { modelProviders: [] },
    ),
  );
  const access = makeToolAccess(settings, {
    reportServerMessage: (message) => {
      messages.push(message);
    },
    ...(timing === undefined ? {} : { timing }),
    ...(fetch === undefined ? {} : { fetch }),
  });
  return { access, messages: () => [...messages] };
}
