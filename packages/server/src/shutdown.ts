import { once } from 'node:events';
import type { Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';

export interface ShutdownHooks {
  readonly closeApi: () => Promise<void>;
  readonly disposeRuntime: () => Promise<void>;
}

const graceMs = 100;

export async function shutDown(server: Server, hooks: ShutdownHooks, timeoutMs: number): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  server.closeIdleConnections();
  await Promise.race([closed, elapsed(timeoutMs)]);
  await hooks.closeApi();
  await hooks.disposeRuntime();
  await Promise.race([closed, elapsed(graceMs)]);
  server.closeAllConnections();
  await closed;
}

function elapsed(ms: number): Promise<void> {
  return setTimeout(ms, undefined, { ref: false });
}
