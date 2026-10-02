import { describe, expect, it, onTestFinished } from 'vitest';

import { startChild, startReaperOf, type ChildCommand, type RunningChild } from './children.ts';

function shell(script: string): ChildCommand {
  return {
    command: '/bin/sh',
    args: ['-c', script],
    environment: {},
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
  };
}

function started(command: ChildCommand, patienceMs?: number): RunningChild {
  const child = startChild(command, patienceMs);
  onTestFinished(async () => {
    await child.stop('SIGKILL');
  });
  return child;
}

async function startedOnceItSaysSo(script: string, patienceMs?: number): Promise<RunningChild> {
  const { promise: announced, resolve: announce } = Promise.withResolvers<void>();
  const child = started(
    {
      ...shell(script),
      stdout: () => {
        announce();
      },
    },
    patienceMs,
  );
  await announced;
  return child;
}

function groupAlive(pid: number | undefined): boolean {
  try {
    process.kill(-Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

describe('a child of the dev runner', () => {
  it('says how it ended when it exits', async () => {
    await expect(started(shell('exit 3')).ended).resolves.toBe('exit code 3');
  });

  it('says which signal ended it', async () => {
    const child = started(shell('sleep 30'));

    child.signal('SIGTERM');

    await expect(child.ended).resolves.toBe('signal SIGTERM');
  });

  it('says why it could not start', async () => {
    const child = started({ ...shell(''), command: '/nonexistent/temporal' });

    await expect(child.ended).resolves.toBe('Error: spawn /nonexistent/temporal ENOENT');
  });

  it('gets a reaper that waits on the runner and leaves the child alone when dismissed', async () => {
    const child = started(shell('sleep 30'));
    const reaper = startReaperOf(child, startChild, {});

    reaper.signal('SIGKILL');

    expect({ reaper: await reaper.ended, child: groupAlive(child.pid) }).toEqual({
      reaper: 'signal SIGKILL',
      child: true,
    });
  });
});

describe('stopping a child of the dev runner', () => {
  it('signals its own process group, and ends only once everything it started is gone', async () => {
    const child = await startedOnceItSaysSo('sleep 30 & echo started; wait');

    const ended = await child.stop('SIGTERM');

    expect({ ended, alive: groupAlive(child.pid) }).toEqual({ ended: 'signal SIGTERM', alive: false });
  });

  it('kills what the child started when that outlives its patience after the signal', async () => {
    const child = await startedOnceItSaysSo("(trap '' TERM; echo started; sleep 30) & wait", 200);

    const ended = await child.stop('SIGTERM');

    expect({ ended, alive: groupAlive(child.pid) }).toEqual({ ended: 'signal SIGTERM', alive: false });
  });

  it('ends at once when the child could not start', async () => {
    const child = started({ ...shell(''), command: '/nonexistent/temporal' });

    await expect(child.stop('SIGTERM')).resolves.toBe('Error: spawn /nonexistent/temporal ENOENT');
  });
});
