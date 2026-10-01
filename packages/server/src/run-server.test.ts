import type { Environment } from '@beonauto/config';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { defaultServerOptions } from './lifecycle.ts';
import { exitOnStartupFailure, runServer, type ServerProcess } from './run-server.ts';
import { stopRequestedBy, type StopSignal } from './stop-request.ts';
import { isAcceptingConnections } from './testing/accepting-connections.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

interface FakeProcess {
  readonly serverProcess: ServerProcess;
  readonly written: readonly string[];
  readonly errors: readonly string[];
  readonly exited: Promise<number>;
  readonly stopRequested: Promise<void>;
  readonly send: (signal: StopSignal) => void;
}

function fakeProcess(env: Environment = loopback): FakeProcess {
  const signals = new EventTarget();
  const written: string[] = [];
  const errors: string[] = [];
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  return {
    serverProcess: {
      env,
      stdout: { write: (message) => written.push(message) },
      stderr: {
        write: (message, flushed) => {
          errors.push(message);
          flushed();
        },
      },
      exit,
    },
    written,
    errors,
    exited,
    stopRequested: stopRequestedBy({
      on: (signal, listener) => {
        signals.addEventListener(signal, listener);
      },
    }),
    send: (signal) => {
      signals.dispatchEvent(new Event(signal));
    },
  };
}

function signalledOnAnnouncement(signal: StopSignal): FakeProcess {
  const fake = fakeProcess();
  const announcements = fake.serverProcess.stdout;
  return {
    ...fake,
    serverProcess: {
      ...fake.serverProcess,
      stdout: {
        write: (message) => {
          announcements.write(message);
          fake.send(signal);
        },
      },
    },
  };
}

function signalledDuringStartUp(signal: StopSignal): { fake: FakeProcess; runtimeLayer: () => Layer.Layer<never> } {
  const fake = fakeProcess();
  const sendTheSignal = Layer.effectDiscard(
    Effect.sync(() => {
      fake.send(signal);
    }),
  );
  return { fake, runtimeLayer: () => sendTheSignal };
}

describe('runServer', () => {
  it('announces the port it listens on', async () => {
    const { serverProcess, written, stopRequested } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions, stopRequested);

    expect(written).toEqual([`auto-brain listening on port ${server.port}\n`]);
    await server.stop();
  });

  it('rejects invalid settings before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written, stopRequested } = fakeProcess({ ...loopback, ALLOWED_ORIGINS: 'app.example.com' });

    await expect(runServer(serverProcess, defaultServerOptions, stopRequested)).rejects.toMatchObject({
      name: 'InvalidSettingsError',
    });
    expect(written).toEqual([]);
  });

  it('rejects invalid API keys before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written, stopRequested } = fakeProcess({ ...loopback, API_KEYS: '[{"id":"ci-1"}]' });

    await expect(runServer(serverProcess, defaultServerOptions, stopRequested)).rejects.toMatchObject({
      name: 'InvalidApiKeysError',
    });
    expect(written).toEqual([]);
  });
});

describe('runServer on a stop signal', () => {
  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops accepting connections on %s, before anything else stops it',
    async (signal) => {
      const { serverProcess, stopRequested, send } = fakeProcess();
      const server = await runServer(serverProcess, defaultServerOptions, stopRequested);

      send(signal);
      const acceptingAfterSignal = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterSignal).toBe(false);
    },
  );

  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops on %s sent the moment it announces the port, because it handles the signal before announcing',
    async (signal) => {
      const { serverProcess, stopRequested } = signalledOnAnnouncement(signal);
      const server = await runServer(serverProcess, defaultServerOptions, stopRequested);

      const acceptingAfterSignal = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterSignal).toBe(false);
    },
  );

  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops as soon as it has started when %s arrived during start-up',
    async (signal) => {
      const { fake, runtimeLayer } = signalledDuringStartUp(signal);
      const server = await runServer(fake.serverProcess, { ...defaultServerOptions, runtimeLayer }, fake.stopRequested);

      const acceptingAfterStartUp = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterStartUp).toBe(false);
    },
  );
});

const startUpFailures: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ API_KEYS: 'abk_ci-1_not-a-list-of-keys' }, 'InvalidApiKeysError: API_KEYS: Expected a valid JSON string'],
  [
    { ALLOWED_ORIGINS: 'app.example.com' },
    'InvalidSettingsError: SchemaError(Expected an origin such as https://app.example.com, received "app.example.com" at ["ALLOWED_ORIGINS"][0] Expected array at ["ALLOWED_ORIGINS"])',
  ],
];

describe('a server that cannot start', () => {
  it.each(startUpFailures)(
    'names the error in one line on stderr, announces nothing and exits 1 with %o',
    async (settings, error) => {
      const { serverProcess, written, errors, exited, stopRequested } = fakeProcess({ ...loopback, ...settings });

      await runServer(serverProcess, defaultServerOptions, stopRequested).catch(exitOnStartupFailure(serverProcess));

      expect(await exited).toBe(1);
      expect({ written, errors }).toEqual({ written: [], errors: [`auto-brain could not start: ${error}\n`] });
    },
  );
});

describe('runServer after it stopped', () => {
  it('exits 0 at the exit deadline, saying why, when the process is still running', async () => {
    const { serverProcess, stopRequested, send, exited, errors } = fakeProcess();
    await runServer(serverProcess, { ...defaultServerOptions, exitDeadlineMs: 10 }, stopRequested);

    send('SIGTERM');

    expect(await exited).toBe(0);
    expect(errors).toEqual(['auto-brain was still running 10 ms after it stopped, so it exits now\n']);
  });
});
