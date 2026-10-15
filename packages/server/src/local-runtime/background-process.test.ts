import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Function } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startInBackgroundOf, startingLockIn } from './background-process.ts';

const recordingEntry = fileURLToPath(new URL('../testing/entries/record-background-start.ts', import.meta.url));

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-background-')));
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

describe('starting the runtime in the background', () => {
  it('starts it from the home of the runtime, writing to its log', async () => {
    startInBackgroundOf({
      execPath: process.execPath,
      execArgv: [],
      entry: recordingEntry,
      home,
      environment: { PATH: process.env['PATH'], NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
      report: Function.constVoid,
    })();

    const runtimeHome = join(home, '.auto-runtime');
    await vi.waitFor(() => {
      expect(existsSync(join(runtimeHome, 'started.json'))).toBe(true);
    });
    expect(JSON.parse(readFileSync(join(runtimeHome, 'started.json'), 'utf8'))).toEqual({
      arguments: ['start', '--background'],
      directory: runtimeHome,
    });
    await vi.waitFor(() => {
      expect(readFileSync(join(runtimeHome, 'runtime.log'), 'utf8')).toBe('started in the background\n');
    });
  });

  it('reports a runtime it could not start', async () => {
    const reported: string[] = [];

    startInBackgroundOf({
      execPath: join(home, 'no-node-here'),
      execArgv: [],
      entry: recordingEntry,
      home,
      environment: {},
      report: (line) => {
        reported.push(line);
      },
    })();

    await vi.waitFor(() => {
      expect(reported).toEqual([expect.stringMatching(/^Auto Runtime could not be started: spawn .*ENOENT$/u)]);
    });
  });
});

describe('the lock that one agent holds while it starts the runtime', () => {
  it('is held by one at a time', () => {
    const lock = startingLockIn(home, () => Date.now());

    expect([lock.take(), lock.take()]).toEqual([true, false]);
    lock.release();
    expect(lock.take()).toBe(true);
  });

  it('is taken over when whoever took it left it for more than a minute', () => {
    const lock = startingLockIn(home, () => Date.now());
    mkdirSync(join(home, '.auto-runtime'));
    writeFileSync(join(home, '.auto-runtime', 'starting.lock'), '');
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    utimesSync(join(home, '.auto-runtime', 'starting.lock'), twoMinutesAgo, twoMinutesAgo);

    expect(lock.take()).toBe(true);
  });

  it('cannot be taken where it cannot be written', () => {
    mkdirSync(join(home, '.auto-runtime'));
    chmodSync(join(home, '.auto-runtime'), 0o500);

    expect(startingLockIn(home, () => Date.now()).take()).toBe(false);
    chmodSync(join(home, '.auto-runtime'), 0o700);
  });
});
