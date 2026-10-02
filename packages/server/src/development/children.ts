import { spawn } from 'node:child_process';

import type { Environment } from '@beonauto/config';

export interface ChildCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Environment;
  readonly stdin: 'ignore' | 'pipe';
  readonly stdout: 'ignore' | 'inherit';
}

export interface RunningChild {
  readonly pid: number | undefined;
  readonly ended: Promise<string>;
  readonly signal: (name: NodeJS.Signals) => boolean;
  readonly signalGroup: (name: NodeJS.Signals) => boolean;
}

export type StartChild = (command: ChildCommand) => RunningChild;

function endingOf(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${String(signal)}` : `exit code ${code}`;
}

function signalGroupOf(pid: number | undefined): (name: NodeJS.Signals) => boolean {
  return (name) => {
    try {
      return process.kill(-Number(pid), name);
    } catch {
      return false;
    }
  };
}

export function startChild({ command, args, environment, stdin, stdout }: ChildCommand): RunningChild {
  const child = spawn(command, args, { detached: true, env: { ...environment }, stdio: [stdin, stdout, 'inherit'] });
  const { promise: ended, resolve: end } = Promise.withResolvers<string>();
  child.once('exit', (code, signal) => {
    end(endingOf(code, signal));
  });
  child.once('error', (error: unknown) => {
    end(String(error));
  });
  return {
    pid: child.pid,
    ended,
    signal: (name) => child.kill(name),
    signalGroup: signalGroupOf(child.pid),
  };
}

const stopWhenTheRunnerIsGone = 'read -r _; kill -TERM "$0"';

export function startReaperOf(child: RunningChild, start: StartChild, environment: Environment): RunningChild {
  return start({
    command: '/bin/sh',
    args: ['-c', stopWhenTheRunnerIsGone, String(child.pid)],
    environment,
    stdin: 'pipe',
    stdout: 'ignore',
  });
}
