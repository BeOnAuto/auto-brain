import { join } from 'node:path';

import type { RuntimeAction, RuntimeControl, RuntimeStatus, StartedBy } from '@on.auto/api';
import type { Environment } from '@on.auto/config';

export interface LocalControl {
  readonly control: RuntimeControl;
  readonly asked: Promise<RuntimeAction>;
}

export interface LocalRun {
  readonly version: string;
  readonly pid: number;
  readonly startedAt: Date;
  readonly directory: string;
  readonly home: string;
  readonly startedBy: StartedBy;
}

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

const defaultPort = '5555';

export function runtimeHomeIn(home: string): string {
  return join(home, '.auto-runtime');
}

export function logFileIn(home: string): string {
  return join(runtimeHomeIn(home), 'runtime.log');
}

export function providerSetupFor(directory: string, port?: string): string {
  const page = `http://localhost:${port ?? defaultPort}`;
  const restart = port === undefined ? 'npx @on.auto/runtime restart' : `PORT=${port} npx @on.auto/runtime restart`;
  return [
    `To add one, ask the person to put a line such as ANTHROPIC_API_KEY=<their key> in ${join(directory, '.env')}, never in this chat,`,
    `then restart Auto Runtime with ${restart} or at ${page}.`,
    'Then offer a first function, as the first-playbook recipe of get_guide does; on.auto/docs has more.',
  ].join(' ');
}

export function isControlledAt(host: string | undefined): boolean {
  return host !== undefined && loopbackHosts.has(host);
}

export function runtimeStatusOf({ home, ...run }: LocalRun): RuntimeStatus {
  return { ...run, logFile: run.startedBy === 'agent' ? logFileIn(home) : undefined };
}

export function localControlOf(status: RuntimeStatus): LocalControl {
  const { promise, resolve } = Promise.withResolvers<RuntimeAction>();
  return {
    control: {
      status: () => status,
      stop: () => {
        resolve('stop');
      },
      restart: () => {
        resolve('restart');
      },
    },
    asked: promise,
  };
}

type Execve = (file: string, args?: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => never;

export interface RestartingProcess {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly argv: readonly string[];
  readonly execve?: Execve | undefined;
  readonly stderr: { write(text: string): unknown };
}

export function restartIn(running: RestartingProcess, environment: Environment): void {
  if (running.execve === undefined) {
    running.stderr.write('Auto Runtime restarts only on macOS and Linux, so it has stopped instead\n');
    return;
  }
  running.execve(running.execPath, [running.execPath, ...running.execArgv, ...running.argv.slice(1)], environment);
}
