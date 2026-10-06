import { Effect } from 'effect';

import type { ServerMessage } from '../access/run-context.ts';
import { makeToolAccess, type ToolAccess } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import { readMcpSettings, type Environment } from '../settings/settings-reading.ts';

export interface AccessOptions {
  readonly allowed?: readonly string[];
  readonly environment?: Environment;
  readonly timing?: Timing;
}

export interface ReportingAccess {
  readonly access: ToolAccess;
  readonly messages: () => readonly ServerMessage[];
}

export function reportingAccess(
  servers: Readonly<Record<string, unknown>>,
  { allowed, environment = {}, timing }: AccessOptions = {},
): ReportingAccess {
  const messages: ServerMessage[] = [];
  const settings = Effect.runSync(
    readMcpSettings(
      {
        ...environment,
        MCP_SERVERS: JSON.stringify(servers),
        ...(allowed === undefined ? {} : { ALLOWED_TOOLS: JSON.stringify(allowed) }),
      },
      { modelProviders: [] },
    ),
  );
  const access = makeToolAccess(settings, {
    reportServerMessage: (message) => {
      messages.push(message);
    },
    ...(timing === undefined ? {} : { timing }),
  });
  return { access, messages: () => [...messages] };
}
