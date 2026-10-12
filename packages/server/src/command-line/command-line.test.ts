import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { runCommandLine, type CommandLineHost } from './command-line.ts';

const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-command-line-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

interface Recorded {
  readonly host: CommandLineHost;
  readonly logged: string[];
  readonly errors: string[];
  readonly started: Readonly<Record<string, string>>[];
}

function recordedHost(): Recorded {
  const logged: string[] = [];
  const errors: string[] = [];
  const started: Readonly<Record<string, string>>[] = [];
  return {
    logged,
    errors,
    started,
    host: {
      environment: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      place: { directory, home: '/home/ada' },
      console: {
        log: (line) => {
          logged.push(line);
        },
        error: (line) => {
          errors.push(line);
        },
      },
      startServer: (settings) => {
        started.push(settings);
        return Promise.resolve();
      },
    },
  };
}

const startedSettings = {
  HOST: '127.0.0.1',
  LOCAL_MODE: 'true',
  LOG_FORMAT: 'pretty',
  LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('starting the server with the auto-runtime command', () => {
  it('starts it in local mode when given no command, and leaves the exit code to the server', async () => {
    const { host, started } = recordedHost();

    await expect(runCommandLine([], host)).resolves.toBeUndefined();
    expect(started).toEqual([startedSettings]);
  });

  it('starts it with start', async () => {
    const { host, started } = recordedHost();

    await runCommandLine(['start'], host);

    expect(started).toEqual([startedSettings]);
  });
});

describe('the other commands of auto-runtime', () => {
  it('issues an API key with key', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['key', '--org', 'acme'], host)).resolves.toBe(0);
    expect(logged[0]).toMatch(/^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/u);
    expect(logged[1]).toMatch(/^API_KEYS entry: \{"id":"[0-9a-f]{8}","sha256":"[0-9a-f]{64}","org":"acme",/u);
  });

  it('refuses a key without an org, as the key command does', async () => {
    const { host, errors } = recordedHost();

    await expect(runCommandLine(['key'], host)).resolves.toBe(1);
    expect(errors.at(-1)).toMatch(/^Arguments: --org <org id>/u);
  });

  it('prints the release version with --version', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['--version'], host)).resolves.toBe(0);
    expect(logged).toEqual([release.version]);
  });

  it('prints its commands with --help', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['--help'], host)).resolves.toBe(0);
    expect(logged[0]).toMatch(/^Usage: auto-runtime \[command\]\n/u);
    expect(logged[0]).toContain('http://localhost:5555');
  });
});

describe('what the auto-runtime command refuses', () => {
  it('refuses a command it does not have with its help', async () => {
    const { host, errors } = recordedHost();

    await expect(runCommandLine(['serve', '--now'], host)).resolves.toBe(1);
    expect(errors[0]).toBe('auto-runtime has no command "serve --now"');
    expect(errors[1]).toMatch(/^Usage: auto-runtime/u);
  });

  it('refuses arguments after start, since settings are environment variables', async () => {
    const { host, errors, started } = recordedHost();

    await expect(runCommandLine(['start', '--port', '6000'], host)).resolves.toBe(1);
    expect(errors[0]).toBe('auto-runtime has no command "start --port 6000"');
    expect(started).toEqual([]);
  });

  it('refuses a name that only an object has', async () => {
    const { host } = recordedHost();

    await expect(runCommandLine(['toString'], host)).resolves.toBe(1);
  });
});
