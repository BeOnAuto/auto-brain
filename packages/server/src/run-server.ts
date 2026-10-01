import type { Environment } from '@beonauto/config';

import { startServer, type RunningServer, type ServerOptions } from './lifecycle.ts';

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
}

export async function runServer<R>(
  serverProcess: ServerProcess,
  options: ServerOptions<R>,
  stopRequested: Promise<void>,
): Promise<RunningServer> {
  const server = await startServer(serverProcess.env, options);
  void stopRequested.then(() => server.stop());
  serverProcess.stdout.write(`auto-brain listening on port ${server.port}\n`);
  return server;
}
