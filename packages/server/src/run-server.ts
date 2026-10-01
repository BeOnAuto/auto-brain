import type { Environment } from '@beonauto/config';

import { startServer, type RunningServer, type ServerOptions } from './lifecycle.ts';

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export async function runServer<R>(serverProcess: ServerProcess, options: ServerOptions<R>): Promise<RunningServer> {
  const server = await startServer(serverProcess.env, options);
  const stopOnSignal = (): void => {
    void server.stop();
  };
  serverProcess.on('SIGTERM', stopOnSignal);
  serverProcess.on('SIGINT', stopOnSignal);
  serverProcess.stdout.write(`auto-brain listening on port ${server.port}\n`);
  return server;
}
