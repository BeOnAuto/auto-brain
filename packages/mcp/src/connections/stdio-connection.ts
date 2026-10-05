import { Redacted } from 'effect';

import type { StdioServerSettings } from '../settings/mcp-settings.ts';
import { connectionOver, openingClient, type McpConnection } from './mcp-connection.ts';
import { StdioProcessTransport, type OutputReport } from './stdio-transport.ts';

export interface StdioOpening {
  readonly timeoutMs: number;
  readonly output: OutputReport;
}

function environmentOf({ env }: StdioServerSettings): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...env].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

export async function openStdio(settings: StdioServerSettings, opening: StdioOpening): Promise<McpConnection> {
  const opened = openingClient(settings.request_id);
  const transport = new StdioProcessTransport(
    { command: settings.command, args: settings.args, env: environmentOf(settings) },
    opened.observations,
    opening.output,
  );
  try {
    await opened.client.connect(transport, { timeout: opening.timeoutMs });
  } catch (failure) {
    await transport.close();
    throw failure;
  }
  return connectionOver(opened.client, opened.observations, opened.closed, () => opened.client.close());
}
