import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { readServerConfig, type Environment } from '@beonauto/config';

import { createHttpServer } from './http-server.ts';

export interface RunningServer {
  readonly port: number;
  stop(): Promise<void>;
}

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export async function startServer(environment: Environment): Promise<RunningServer> {
  const { host, port } = readServerConfig(environment);
  const server = createHttpServer();
  server.listen(port, host);
  await once(server, 'listening');
  let stopping: Promise<void> | undefined;
  return {
    port: tcpPort(server.address()),
    stop: async () => {
      stopping ??= close(server);
      await stopping;
    },
  };
}

export async function runServer(serverProcess: ServerProcess): Promise<RunningServer> {
  const server = await startServer(serverProcess.env);
  serverProcess.stdout.write(`auto-brain listening on port ${server.port}\n`);
  const stopOnSignal = (): void => {
    void server.stop();
  };
  serverProcess.once('SIGTERM', stopOnSignal);
  serverProcess.once('SIGINT', stopOnSignal);
  return server;
}

export function tcpPort(address: Readonly<AddressInfo> | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new TypeError('The server is not listening on a TCP port');
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  server.closeIdleConnections();
  await closed;
}
