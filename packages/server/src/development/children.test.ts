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

function started(command: ChildCommand): RunningChild {
  const child = startChild(command);
  onTestFinished(async () => {
    child.signalGroup('SIGKILL');
    await child.ended;
  });
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

  it('runs in its own process group, which a group signal ends with everything it started', async () => {
    const child = started(shell('sleep 30 & wait'));

    child.signalGroup('SIGTERM');
    const ended = await child.ended;
    child.signalGroup('SIGTERM');

    expect({ ended, alive: groupAlive(child.pid) }).toEqual({ ended: 'signal SIGTERM', alive: false });
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
