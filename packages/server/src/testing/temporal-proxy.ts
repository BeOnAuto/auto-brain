import { on, once } from 'node:events';
import { connect, createServer, Socket } from 'node:net';

import { Schema } from 'effect';

import { tcpPort } from '../lifecycle.ts';

export interface TemporalProxy {
  readonly address: string;
  readonly openConnections: () => number;
  readonly close: () => void;
}

const socketOf = Schema.decodeUnknownSync(Schema.instanceOf(Socket));

export async function temporalProxy(address: string): Promise<TemporalProxy> {
  const target = new URL(`tcp://${address}`);
  const open = new Set<Socket>();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  void (async () => {
    for await (const event of on(server, 'connection', { close: ['close'] })) {
      const incoming = socketOf(event[0]);
      const outgoing = connect(Number(target.port), target.hostname);
      const end = (): void => {
        open.delete(incoming);
        incoming.destroy();
        outgoing.destroy();
      };
      open.add(incoming);
      incoming.pipe(outgoing).pipe(incoming);
      incoming.on('error', end).on('close', end);
      outgoing.on('error', end).on('close', end);
    }
  })();
  return {
    address: `127.0.0.1:${tcpPort(server.address())}`,
    openConnections: () => open.size,
    close: () => {
      server.close();
    },
  };
}
