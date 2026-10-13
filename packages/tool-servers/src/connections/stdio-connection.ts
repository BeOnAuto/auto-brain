import { Redacted } from 'effect';

import type { StdioServerSettings } from '../settings/server-settings.ts';
import {
  boundedReport,
  connectionOver,
  errorsNoLongerReported,
  openingClient,
  type ClientInfo,
  type OutputReport,
} from './mcp-connection.ts';
import type { ServerConnection } from './server-connection.ts';
import { StdioProcessTransport } from './stdio-transport.ts';

export interface StdioOpening {
  readonly client: ClientInfo;
  readonly timeoutMs: number;
  readonly output: OutputReport;
}

function environmentOf({ env }: StdioServerSettings): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...env].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

export async function openStdio(settings: StdioServerSettings, opening: StdioOpening): Promise<ServerConnection> {
  const opened = openingClient(
    opening.client,
    settings.request_id,
    boundedReport(opening.output, errorsNoLongerReported),
  );
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
