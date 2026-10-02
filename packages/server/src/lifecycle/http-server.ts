import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { ApiHandler } from '@beonauto/api';

export function createHttpServer(listener: ApiHandler['listener']): Server {
  const server = createServer((request, response) => {
    response.once('finish', () => {
      closeIdleConnectionsOnceClosing(server);
    });
    void listener(request, response);
  });
  return server;
}

export async function listen(server: Server, port: number, host: string): Promise<void> {
  server.listen(port, host);
  await once(server, 'listening');
}

function closeIdleConnectionsOnceClosing(server: Server): void {
  if (!server.listening) {
    server.closeIdleConnections();
  }
}
