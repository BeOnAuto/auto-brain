import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import type { Environment } from '@beonauto/config';

import { startReaperOf, type ChildCommand, type RunningChild } from './children.ts';
import type { DevelopmentRun, DevelopmentSetup } from './development-run.ts';
import { sourcesOf, watchSources, type SourceChanges } from './source-changes.ts';
import { stopRequestedThrough, type DevelopmentStopSignal } from './stop-signals.ts';
import { temporalFor, type DevelopmentTemporal } from './temporal-setup.ts';

export interface DevelopmentProcess {
  readonly env: Environment;
  readonly execPath: string;
  readonly stderr: { write(text: string): unknown };
  on(signal: DevelopmentStopSignal, listener: () => void): unknown;
}

type Event = 'stop' | { readonly changed: string } | { readonly server: string } | { readonly temporal: string };

const never = Promise.withResolvers<string>().promise;

function presentEnvFiles({ envFiles }: DevelopmentSetup): readonly string[] {
  return envFiles.filter((envFile) => existsSync(envFile));
}

function serverCommand(run: DevelopmentRun, { address }: DevelopmentTemporal): ChildCommand {
  return {
    command: run.execPath,
    args: [...presentEnvFiles(run.setup).map((envFile) => `--env-file=${envFile}`), run.setup.serverEntry],
    environment: address === undefined ? run.environment : { ...run.environment, TEMPORAL_ADDRESS: address },
    stdin: 'ignore',
    stdout: 'inherit',
  };
}

async function stopped(signal: NodeJS.Signals, children: readonly (RunningChild | undefined)[]): Promise<void> {
  const running = children.filter((child): child is RunningChild => child !== undefined);
  for (const child of running) {
    child.signal(signal);
  }
  await Promise.all(running.map(({ ended }) => ended));
}

interface Serving {
  readonly temporal: DevelopmentTemporal;
  readonly server: RunningChild | undefined;
  readonly changes: SourceChanges;
}

async function restarted(run: DevelopmentRun, { temporal, server, changes }: Serving, file: string): Promise<number> {
  run.say(`${file} changed, so the server restarts`);
  await stopped('SIGTERM', [server]);
  const stopping = await Promise.race([run.stopRequested, Promise.resolve('restart')]);
  if (stopping === 'stop') {
    await stopped('SIGTERM', [temporal.child]);
    return 0;
  }
  return served(run, { temporal, server: run.start(serverCommand(run, temporal)), changes });
}

async function served(run: DevelopmentRun, serving: Serving): Promise<number> {
  const { temporal, server, changes } = serving;
  const event = await Promise.race<Event>([
    run.stopRequested,
    changes.next().then((changed) => ({ changed })),
    (server?.ended ?? never).then((reason) => ({ server: reason })),
    (temporal.child?.ended ?? never).then((reason) => ({ temporal: reason })),
  ]);
  if (event === 'stop') {
    await stopped('SIGTERM', [server]);
    await stopped('SIGTERM', [temporal.child]);
    return 0;
  }
  if ('changed' in event) {
    return restarted(run, serving, event.changed);
  }
  if ('server' in event) {
    run.say(`The server stopped (${event.server}); it starts again when a file changes`);
    return served(run, { ...serving, server: undefined });
  }
  run.say(`Temporal's dev server stopped (${event.temporal}), so the server stops too`);
  await stopped('SIGTERM', [server]);
  return 1;
}

function settingsOf(environment: Environment, setup: DevelopmentSetup): Environment {
  const settings: Record<string, string | undefined> = {};
  for (const envFile of presentEnvFiles(setup)) {
    Object.assign(settings, parseEnv(readFileSync(envFile, 'utf8')));
  }
  return { ...settings, ...environment };
}

export async function runDevelopment(host: DevelopmentProcess, setup: DevelopmentSetup): Promise<number> {
  const stopRequested = stopRequestedThrough(host).then((): 'stop' => 'stop');
  const reapers: RunningChild[] = [];
  const run: DevelopmentRun = {
    setup,
    execPath: host.execPath,
    environment: host.env,
    settings: settingsOf(host.env, setup),
    say: (message) => {
      host.stderr.write(`${message}\n`);
    },
    stopRequested,
    start: (command) => {
      const child = setup.startChild(command);
      const reaper = startReaperOf(child, setup.startChild, host.env);
      reapers.push(reaper);
      void child.ended.then(() => reaper.signal('SIGKILL'));
      return child;
    },
  };
  const temporal = await temporalFor(run);
  const changes = watchSources(sourcesOf(setup.sourceDirectories, setup.envFiles));
  const exitCode =
    temporal === 'stopped'
      ? 0
      : await served(run, { temporal, server: run.start(serverCommand(run, temporal)), changes });
  changes.close();
  await stopped('SIGKILL', reapers);
  return exitCode;
}
