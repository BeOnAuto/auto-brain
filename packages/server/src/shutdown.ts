import { once } from 'node:events';
import type { Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';

export interface Closeables {
  readonly closeApi: () => Promise<void>;
  readonly disposeRuntime: () => Promise<void>;
}

const graceMs = 100;

export async function shutDown(server: Server, closeables: Closeables, deadlineMs: number): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  server.closeIdleConnections();
  await Promise.race([closed, elapsed(deadlineMs)]);
  await closeables.closeApi();
  await closeables.disposeRuntime();
  await Promise.race([closed, elapsed(graceMs)]);
  server.closeAllConnections();
  await closed;
}

function elapsed(ms: number): Promise<void> {
  return setTimeout(ms, undefined, { ref: false });
}
