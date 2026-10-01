import { setTimeout } from 'node:timers/promises';

import type { Environment } from '@beonauto/config';

import { startServer, type RunningServer, type ServerOptions } from './lifecycle.ts';

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
  readonly stderr: { write(message: string, flushed: () => void): unknown };
  exit(code: number): void;
}

async function stopThenExit(
  server: RunningServer,
  serverProcess: ServerProcess,
  { exitDeadlineMs }: { readonly exitDeadlineMs: number },
): Promise<void> {
  await server.stop();
  await setTimeout(exitDeadlineMs, undefined, { ref: false });
  serverProcess.stderr.write(
    `auto-brain was still running ${exitDeadlineMs} ms after it stopped, so it exits now\n`,
    () => {
      serverProcess.exit(0);
    },
  );
}

export async function runServer<R>(
  serverProcess: ServerProcess,
  options: ServerOptions<R>,
  stopRequested: Promise<void>,
): Promise<RunningServer> {
  const server = await startServer(serverProcess.env, options);
  void stopRequested.then(() => stopThenExit(server, serverProcess, options));
  serverProcess.stdout.write(`auto-brain listening on port ${server.port}\n`);
  return server;
}
