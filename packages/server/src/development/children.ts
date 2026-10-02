import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';

import type { Environment } from '@beonauto/config';

export type Written = (text: string) => void;

export interface ChildCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Environment;
  readonly stdin: 'ignore' | 'pipe';
  readonly stdout: 'ignore' | Written;
  readonly stderr: 'inherit' | Written;
}

export interface RunningChild {
  readonly pid: number | undefined;
  readonly ended: Promise<string>;
  readonly signal: (name: NodeJS.Signals) => boolean;
  readonly stop: (name: NodeJS.Signals) => Promise<string>;
}

export type StartChild = (command: ChildCommand) => RunningChild;

function endingOf(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${String(signal)}` : `exit code ${code}`;
}

const leastGroupId = 2;

const groupPollMs = 50;

const groupPatienceMs = 5_000;

type GroupSignal = (name: NodeJS.Signals | 0) => boolean;

function signalGroupOf(pid: number | undefined): GroupSignal {
  return (name) => {
    if (pid === undefined || pid < leastGroupId) {
      return false;
    }
    try {
      return process.kill(-pid, name);
    } catch {
      return false;
    }
  };
}

async function groupGone(signalGroup: GroupSignal, deadline: number): Promise<boolean> {
  if (!signalGroup(0)) {
    return true;
  }
  if (Date.now() >= deadline) {
    return false;
  }
  await setTimeout(groupPollMs);
  return groupGone(signalGroup, deadline);
}

function stopOf(pid: number | undefined, ended: Promise<string>, patienceMs: number) {
  const signalGroup = signalGroupOf(pid);
  return async (name: NodeJS.Signals): Promise<string> => {
    signalGroup(name);
    const ending = await ended;
    if (!(await groupGone(signalGroup, Date.now() + patienceMs))) {
      signalGroup('SIGKILL');
      await groupGone(signalGroup, Date.now() + patienceMs);
    }
    return ending;
  };
}

function streamOf(output: 'ignore' | 'inherit' | Written): 'ignore' | 'inherit' | 'pipe' {
  return typeof output === 'function' ? 'pipe' : output;
}

export function startChild(
  { command, args, environment, stdin, stdout, stderr }: ChildCommand,
  patienceMs = groupPatienceMs,
): RunningChild {
  const child = spawn(command, args, {
    detached: true,
    env: { ...environment },
    stdio: [stdin, streamOf(stdout), streamOf(stderr)],
  });
  const { promise: ended, resolve: end } = Promise.withResolvers<string>();
  child.once('exit', (code, signal) => {
    end(endingOf(code, signal));
  });
  child.once('error', (error: unknown) => {
    end(String(error));
  });
  if (typeof stdout === 'function') {
    child.stdout?.setEncoding('utf8').on('data', stdout);
  }
  if (typeof stderr === 'function' && child.stderr !== null) {
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', stderr);
  }
  return {
    pid: child.pid,
    ended,
    signal: (name) => child.kill(name),
    stop: stopOf(child.pid, ended, patienceMs),
  };
}

const stopWhenTheRunnerIsGone = 'read -r _; [ "$0" -gt 1 ] 2>/dev/null && kill -TERM -"$0"';

export function startReaperOf(child: RunningChild, start: StartChild, environment: Environment): RunningChild {
  return start({
    command: '/bin/sh',
    args: ['-c', stopWhenTheRunnerIsGone, String(child.pid)],
    environment,
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'inherit',
  });
}
