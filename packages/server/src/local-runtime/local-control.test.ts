import { describe, expect, it } from 'vitest';

import {
  isControlledAt,
  localControlOf,
  logFileIn,
  restartIn,
  runtimeStatusOf,
  type LocalRun,
  type RestartingProcess,
} from './local-control.ts';

const inATerminal: LocalRun = {
  version: '0.9.1',
  pid: 4242,
  startedAt: new Date('2026-10-14T09:41:07.000Z'),
  directory: '/Users/ada/playbooks',
  home: '/Users/ada',
  startedBy: 'terminal',
};

describe('the status of a runtime the auto-runtime command started', () => {
  it('names no log when it writes to the terminal it started in', () => {
    expect(runtimeStatusOf(inATerminal)).toEqual({
      version: '0.9.1',
      pid: 4242,
      startedAt: new Date('2026-10-14T09:41:07.000Z'),
      directory: '/Users/ada/playbooks',
      startedBy: 'terminal',
      logFile: undefined,
    });
  });

  it('names the log in the home of the runtime when an agent started it', () => {
    expect(runtimeStatusOf({ ...inATerminal, startedBy: 'agent' }).logFile).toBe(
      '/Users/ada/.auto-runtime/runtime.log',
    );
    expect(logFileIn('/Users/ada')).toBe('/Users/ada/.auto-runtime/runtime.log');
  });
});

describe('where a runtime may be controlled', () => {
  it.each(['127.0.0.1', '::1', 'localhost'])('is controlled when it listens on %s', (host) => {
    expect(isControlledAt(host)).toBe(true);
  });

  it.each([undefined, '0.0.0.0', '::', '192.168.1.20'])(
    'is not controlled when it listens on %s, where others may reach it',
    (host) => {
      expect(isControlledAt(host)).toBe(false);
    },
  );
});

describe('asking a runtime to stop or restart', () => {
  it('says what was asked first', async () => {
    const { control, asked } = localControlOf(runtimeStatusOf(inATerminal));

    control.restart();
    control.stop();

    await expect(asked).resolves.toBe('restart');
  });

  it('says it was asked to stop', async () => {
    const { control, asked } = localControlOf(runtimeStatusOf(inATerminal));

    control.stop();

    await expect(asked).resolves.toBe('stop');
  });

  it('reports the status it was given', () => {
    const status = runtimeStatusOf(inATerminal);

    expect(localControlOf(status).control.status()).toBe(status);
  });
});

interface Executed {
  readonly file: string;
  readonly args: readonly string[] | undefined;
  readonly env: Readonly<NodeJS.ProcessEnv> | undefined;
}

interface Restarting {
  readonly running: RestartingProcess;
  readonly executed: readonly Executed[];
  readonly said: readonly string[];
}

function restarting(): Restarting {
  const executed: Executed[] = [];
  const said: string[] = [];
  return {
    executed,
    said,
    running: {
      execPath: '/usr/local/bin/node',
      execArgv: ['--max-old-space-size=4096'],
      argv: ['/usr/local/bin/node', '/cache/packages/server/auto-runtime.ts', 'start'],
      execve: (file, args, env): never => {
        executed.push({ file, args, env });
        throw new Error('replaced');
      },
      stderr: {
        write: (text) => {
          said.push(text);
        },
      },
    },
  };
}

describe('restarting the process of the runtime', () => {
  it('runs the same command again in its place, with the environment it first had', () => {
    const { running, executed } = restarting();

    expect(() => {
      restartIn(running, { PATH: '/usr/bin' });
    }).toThrow('replaced');
    expect(executed).toEqual([
      {
        file: '/usr/local/bin/node',
        args: ['/usr/local/bin/node', '--max-old-space-size=4096', '/cache/packages/server/auto-runtime.ts', 'start'],
        env: { PATH: '/usr/bin' },
      },
    ]);
  });

  it('says it stopped instead where a process cannot replace itself', () => {
    const { running, said } = restarting();

    restartIn({ ...running, execve: undefined }, {});

    expect(said).toEqual(['Auto Runtime restarts only on macOS and Linux, so it has stopped instead\n']);
  });
});
