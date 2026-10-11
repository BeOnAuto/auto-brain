import type { RecordedContent } from '@beonauto/operations';
import { memoryRecordedContent } from '@beonauto/operations/testing';
import { Effect } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import { makeToolAccess, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import { ignored } from '../connections/ignored.ts';
import { readMcpSettings, type Environment } from '../settings/settings-reading.ts';

export interface AccessOptions {
  readonly environment?: Environment;
  readonly timing?: Timing;
  readonly fetch?: ToolAccessOptions['fetch'];
}

export interface ReportingAccess {
  readonly access: ToolAccess;
  readonly content: RecordedContent;
  readonly messages: () => readonly ServerMessage[];
  readonly untestable: () => readonly string[];
}

export function reportingAccess(
  servers: Readonly<Record<string, unknown>>,
  { environment = {}, timing, fetch }: AccessOptions = {},
): ReportingAccess {
  const messages: ServerMessage[] = [];
  const untestable: string[] = [];
  const content = memoryRecordedContent();
  const settings = Effect.runSync(
    readMcpSettings({ ...environment, MCP_SERVERS: JSON.stringify(servers) }, { modelProviders: [] }),
  );
  const access = makeToolAccess(settings, {
    content,
    reportServerMessage: (message) => {
      messages.push(message);
    },
    reportUntestable: (server) => {
      untestable.push(server);
    },
    ...(timing === undefined ? {} : { timing }),
    ...(fetch === undefined ? {} : { fetch }),
  });
  return { access, content, messages: () => [...messages], untestable: () => [...untestable] };
}

export const noToolServers: ToolAccess = makeToolAccess(
  { servers: [] },
  { content: memoryRecordedContent(), reportServerMessage: ignored, reportUntestable: ignored },
);
