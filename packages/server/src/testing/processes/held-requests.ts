import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, vi } from 'vitest';

import { callInFlightFileVariable } from '../entries/calls-in-flight.ts';
import { isAcceptingConnections } from './accepting-connections.ts';
import { spawnServer, type SpawnedServer } from './spawned-server.ts';

interface HeldAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface HoldingServer {
  readonly child: SpawnedServer;
  readonly port: number;
  readonly answer: Promise<HeldAnswer | 'unanswered'>;
  readonly abandon: () => void;
}

const patiently = { timeout: 30_000, interval: 10 };

function callInFlightFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-held-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'call-in-flight');
}

export function untilCallInFlight(file: string): Promise<void> {
  return vi.waitFor(() => {
    expect(existsSync(file)).toBe(true);
  }, patiently);
}

export function untilRefusingConnections(port: number): Promise<void> {
  return vi.waitFor(async () => {
    expect(await isAcceptingConnections(port)).toBe(false);
  }, patiently);
}

export async function serverHoldingARequest(
  entry: string,
  environment: Readonly<Record<string, string>>,
): Promise<HoldingServer> {
  const inFlight = callInFlightFile();
  const child = spawnServer(entry, {
    HOST: '127.0.0.1',
    PORT: '0',
    [callInFlightFileVariable]: inFlight,
    ...environment,
  });
  const port = await child.port;
  const client = new AbortController();
  const answer = fetch(`http://127.0.0.1:${port}/held`, { signal: client.signal }).then(
    async (response): Promise<HeldAnswer> => ({ status: response.status, body: await response.json() }),
    (): 'unanswered' => 'unanswered',
  );
  await untilCallInFlight(inFlight);
  return {
    child,
    port,
    answer,
    abandon: () => {
      client.abort();
    },
  };
}
