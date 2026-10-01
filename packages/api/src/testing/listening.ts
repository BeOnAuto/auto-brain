import { once } from 'node:events';
import { createServer } from 'node:http';

import { Schema } from 'effect';

import type { ApiHandler } from '../index.ts';

export interface Listening {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

export async function listenOnLoopback(handler: ApiHandler): Promise<Listening> {
  const server = createServer((request, response) => {
    void handler.listener(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = portOf(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
      await handler.close();
    },
  };
}
