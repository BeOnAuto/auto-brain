import type { Environment } from '@beonauto/config';

import { startReaperOf, type ChildCommand, type RunningChild, type Written } from './children.ts';
import type { DevelopmentRun, DevelopmentSetup } from './development-run.ts';
import { readyNotice } from './ready-notice.ts';
import { runnerLogFor } from './runner-log.ts';
import { presentEnvFiles, rootConfigFile, settingsOf, watchedConfigFile } from './settings-files.ts';
import { sourcesOf, watchSources, type SourceChanges } from './source-changes.ts';
import { stopRequestedThrough, type DevelopmentStopSignal } from './stop-signals.ts';
import { temporalFor, type DevelopmentTemporal } from './temporal-setup.ts';

export interface DevelopmentProcess {
  readonly env: Environment;
  readonly execPath: string;
  readonly stdout: { write(text: string): unknown };
  on(signal: DevelopmentStopSignal, listener: () => void): unknown;
}

type Event = 'stop' | { readonly changed: string } | { readonly server: string } | { readonly temporal: string };

const never = Promise.withResolvers<string>().promise;

function serverCommand(run: DevelopmentRun, { temporal: { address }, output }: Serving): ChildCommand {
  return {
    command: run.execPath,
    args: [...presentEnvFiles(run.setup).map((envFile) => `--env-file=${envFile}`), run.setup.serverEntry],
    environment: {
      ...run.environment,
      ...rootConfigFile(run),
      ...(address === undefined ? {} : { TEMPORAL_ADDRESS: address }),
    },
    stdin: 'ignore',
    stdout: output,
    stderr: 'inherit',
  };
}

async function stopped(signal: NodeJS.Signals, children: readonly (RunningChild | undefined)[]): Promise<void> {
  const running = children.filter((child): child is RunningChild => child !== undefined);
  await Promise.all(running.map((child) => child.stop(signal)));
}

interface Serving {
  readonly temporal: DevelopmentTemporal;
  readonly server: RunningChild | undefined;
  readonly changes: SourceChanges;
  readonly output: Written;
}

async function restarted(run: DevelopmentRun, serving: Serving, file: string): Promise<number> {
  const { temporal, server } = serving;
  run.log.info(`${file} changed, so the server restarts`);
  await stopped('SIGTERM', [server]);
  const stopping = await Promise.race([run.stopRequested, Promise.resolve('restart')]);
  if (stopping === 'stop') {
    await stopped('SIGTERM', [temporal.child]);
    return 0;
  }
  return served(run, { ...serving, server: run.start(serverCommand(run, serving)) });
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
    run.log.warn(`The server stopped (${event.server}); it starts again when a file changes`);
    await stopped('SIGTERM', [server]);
    return served(run, { ...serving, server: undefined });
  }
  run.log.error(`Temporal's dev server stopped (${event.temporal}), so the server stops too`);
  await stopped('SIGTERM', [server, temporal.child]);
  return 1;
}

function announcingReadiness(host: DevelopmentProcess, run: DevelopmentRun, workflows: string): Written {
  const { promise: listening, resolve: heard } = Promise.withResolvers<string>();
  void (async () => {
    const line = await listening;
    run.log.info(
      readyNotice(Number(/port (\d+)/u.exec(line)?.[1]), workflows, { ...run.settings, ...rootConfigFile(run) }),
    );
  })();
  return (text) => {
    host.stdout.write(text);
    heard(text);
  };
}

function servedFirst(
  host: DevelopmentProcess,
  run: DevelopmentRun,
  { temporal, changes }: Pick<Serving, 'temporal' | 'changes'>,
): Promise<number> {
  const serving = { temporal, changes, server: undefined, output: announcingReadiness(host, run, temporal.workflows) };
  return served(run, { ...serving, server: run.start(serverCommand(run, serving)) });
}

export async function runDevelopment(host: DevelopmentProcess, setup: DevelopmentSetup): Promise<number> {
  const stopRequested = stopRequestedThrough(host).then((): 'stop' => 'stop');
  const reapers: RunningChild[] = [];
  const settings = settingsOf(host.env, setup);
  const run: DevelopmentRun = {
    setup,
    execPath: host.execPath,
    environment: host.env,
    settings,
    log: runnerLogFor(settings),
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
  const changes = watchSources(
    sourcesOf(setup.sourceDirectories, [...setup.envFiles, watchedConfigFile(settings, setup)]),
  );
  const exitCode = temporal === 'stopped' ? 0 : await servedFirst(host, run, { temporal, changes });
  changes.close();
  await stopped('SIGKILL', reapers);
  return exitCode;
}
