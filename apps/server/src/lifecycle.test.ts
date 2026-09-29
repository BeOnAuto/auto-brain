import { describe, expect, it } from 'vitest';

import { runServer, startServer, tcpPort, type ServerProcess } from './lifecycle.ts';

function fakeProcess(): { serverProcess: ServerProcess; signals: EventTarget; written: string[] } {
  const signals = new EventTarget();
  const written: string[] = [];
  const serverProcess: ServerProcess = {
    env: { HOST: '127.0.0.1', PORT: '0' },
    stdout: { write: (message) => written.push(message) },
    once: (signal, listener) => {
      signals.addEventListener(signal, listener, { once: true });
    },
  };
  return { serverProcess, signals, written };
}

async function isAcceptingConnections(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}

describe('startServer', () => {
  it('listens on the port the operating system assigns for port 0', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' });

    expect(await isAcceptingConnections(server.port)).toBe(true);
    await server.stop();
  });

  it('stops accepting connections once stopped, and stopping again is harmless', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' });
    await server.stop();
    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('rejects when the port is already taken', async () => {
    const first = await startServer({ HOST: '127.0.0.1', PORT: '0' });

    await expect(startServer({ HOST: '127.0.0.1', PORT: String(first.port) })).rejects.toThrow('EADDRINUSE');
    await first.stop();
  });
});

describe('runServer', () => {
  it('announces the port it listens on', async () => {
    const { serverProcess, written } = fakeProcess();
    const server = await runServer(serverProcess);

    expect(written).toEqual([`auto-brain listening on port ${server.port}\n`]);
    await server.stop();
  });

  it.each(['SIGTERM', 'SIGINT'])('shuts down gracefully on %s', async (signal) => {
    const { serverProcess, signals } = fakeProcess();
    const server = await runServer(serverProcess);

    signals.dispatchEvent(new Event(signal));
    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });
});

describe('tcpPort', () => {
  it('reads the port of a TCP address', () => {
    expect(tcpPort({ address: '127.0.0.1', family: 'IPv4', port: 4321 })).toBe(4321);
  });

  it.each([null, '/tmp/auto-brain.sock'])('refuses %s because it is not a TCP address', (address) => {
    expect(() => tcpPort(address)).toThrow(new TypeError('The server is not listening on a TCP port'));
  });
});
