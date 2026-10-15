import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';

import type { StartingLock } from './background-start.ts';
import { logFileIn, runtimeHomeIn } from './local-control.ts';

export interface BackgroundCommand {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly entry: string;
  readonly home: string;
  readonly environment: Environment;
  readonly report: (line: string) => void;
}

export const backgroundArguments: readonly string[] = ['start', '--background'];

export function startInBackgroundOf(command: BackgroundCommand): () => void {
  return () => {
    const runtimeHome = runtimeHomeIn(command.home);
    mkdirSync(runtimeHome, { recursive: true });
    const log = openSync(logFileIn(command.home), 'a');
    try {
      spawn(command.execPath, [...command.execArgv, command.entry, ...backgroundArguments], {
        cwd: runtimeHome,
        detached: true,
        stdio: ['ignore', log, log],
        env: { ...command.environment },
      })
        .on('error', (error: Readonly<Error>) => {
          command.report(`Auto Runtime could not be started: ${error.message}`);
        })
        .unref();
    } finally {
      closeSync(log);
    }
  };
}

const staleLockMs = 60_000;

function created(file: string): boolean {
  try {
    closeSync(openSync(file, 'wx'));
    return true;
  } catch {
    return false;
  }
}

function isStale(file: string, now: () => number): boolean {
  const since = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? now();
  return now() - since > staleLockMs;
}

export function startingLockIn(home: string, now: () => number = Date.now): StartingLock {
  const file = join(runtimeHomeIn(home), 'starting.lock');
  const release = (): void => {
    rmSync(file, { force: true });
  };
  return {
    take: () => {
      mkdirSync(runtimeHomeIn(home), { recursive: true });
      if (created(file)) {
        return true;
      }
      if (!isStale(file, now)) {
        return false;
      }
      release();
      return created(file);
    },
    release,
  };
}
