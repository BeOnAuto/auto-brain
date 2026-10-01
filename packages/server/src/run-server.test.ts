import type { Environment } from '@beonauto/config';
import { describe, expect, it } from 'vitest';

import { defaultServerOptions } from './lifecycle.ts';
import { runServer, type ServerProcess } from './run-server.ts';
import { isAcceptingConnections } from './testing/accepting-connections.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

function fakeProcess(env: Environment = loopback): {
  serverProcess: ServerProcess;
  signals: EventTarget;
  written: string[];
} {
  const signals = new EventTarget();
  const written: string[] = [];
  const serverProcess: ServerProcess = {
    env,
    stdout: { write: (message) => written.push(message) },
    on: (signal, listener) => {
      signals.addEventListener(signal, listener);
    },
  };
  return { serverProcess, signals, written };
}

function signalledOnAnnouncement(signal: 'SIGINT' | 'SIGTERM'): ServerProcess {
  const { serverProcess, signals } = fakeProcess();
  return {
    ...serverProcess,
    stdout: {
      write: (message) => {
        serverProcess.stdout.write(message);
        signals.dispatchEvent(new Event(signal));
      },
    },
  };
}

describe('runServer', () => {
  it('announces the port it listens on', async () => {
    const { serverProcess, written } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions);

    expect(written).toEqual([`auto-brain listening on port ${server.port}\n`]);
    await server.stop();
  });

  it.each(['SIGTERM', 'SIGINT'])('stops accepting connections on %s, before anything else stops it', async (signal) => {
    const { serverProcess, signals } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions);

    signals.dispatchEvent(new Event(signal));
    const acceptingAfterSignal = await isAcceptingConnections(server.port);
    await server.stop();

    expect(acceptingAfterSignal).toBe(false);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'stops on %s sent the moment it announces the port, because it handles the signal before announcing',
    async (signal) => {
      const server = await runServer(signalledOnAnnouncement(signal), defaultServerOptions);

      const acceptingAfterSignal = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterSignal).toBe(false);
    },
  );

  it('rejects invalid settings before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written } = fakeProcess({ ...loopback, ALLOWED_ORIGINS: 'app.example.com' });

    await expect(runServer(serverProcess, defaultServerOptions)).rejects.toMatchObject({
      name: 'InvalidSettingsError',
    });
    expect(written).toEqual([]);
  });

  it('rejects invalid API keys before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written } = fakeProcess({ ...loopback, API_KEYS: '[{"id":"ci-1"}]' });

    await expect(runServer(serverProcess, defaultServerOptions)).rejects.toMatchObject({ name: 'InvalidApiKeysError' });
    expect(written).toEqual([]);
  });
});
