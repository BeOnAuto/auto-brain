import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { temporalCliVersion } from '@beonauto/orchestration/testing/temporal-cli';

import type { ChildCommand, RunningChild } from './children.ts';
import type { DevelopmentRun, LocalTemporal } from './development-run.ts';
import { answerPatienceMs, whatAnswersOn, type PortAnswer } from './temporal-answer.ts';

export interface DevelopmentTemporal {
  readonly address: string | undefined;
  readonly child: RunningChild | undefined;
  readonly workflows: string;
}

type Readiness = 'ready' | 'stopping' | { readonly ended: string };

type Started = { readonly running: RunningChild } | Exclude<Readiness, 'ready'>;

const withoutTemporal: DevelopmentTemporal = { address: undefined, child: undefined, workflows: 'off' };

const howToGetWorkflows = 'to get workflows, run `temporal server start-dev` and restart, or set TEMPORAL_ADDRESS';

function oneLine(reason: unknown): string {
  return String(reason).replaceAll(/\s*\n\s*/gu, ' ');
}

function temporalCommand(cli: string, { port, uiPort, stateFile }: LocalTemporal, run: DevelopmentRun): ChildCommand {
  return {
    command: cli,
    args: [
      'server',
      'start-dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--ui-port',
      String(uiPort),
      '--db-filename',
      stateFile,
      '--log-level',
      'error',
      '--log-format',
      'json',
    ],
    environment: run.environment,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: run.log.temporal,
  };
}

async function webUiAnswers(uiPort: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${uiPort}`, { method: 'HEAD', signal: AbortSignal.timeout(answerPatienceMs) });
    return true;
  } catch {
    return false;
  }
}

async function readinessOf(local: LocalTemporal, child: RunningChild, run: DevelopmentRun): Promise<Readiness> {
  const ended = child.ended.then((reason): Readiness => ({ ended: reason }));
  const stopping = run.stopRequested.then((): Readiness => 'stopping');
  const answered = Promise.all([whatAnswersOn(`127.0.0.1:${local.port}`), webUiAnswers(local.uiPort)]).then(
    ([answer, ui]: readonly [PortAnswer, boolean]): Readiness | 'waiting' =>
      answer === 'Temporal' && ui ? 'ready' : 'waiting',
  );
  const answer = await Promise.race([ended, stopping, answered]);
  if (answer !== 'waiting') {
    return answer;
  }
  await setTimeout(100);
  return readinessOf(local, child, run);
}

async function startedTemporal(run: DevelopmentRun, cli: string, local: LocalTemporal): Promise<Started> {
  try {
    await mkdir(dirname(local.stateFile), { recursive: true });
  } catch (failure) {
    return { ended: oneLine(failure) };
  }
  const child = run.start(temporalCommand(cli, local, run));
  const readiness = await readinessOf(local, child, run);
  if (readiness === 'stopping') {
    await child.stop('SIGTERM');
  }
  return readiness === 'ready' ? { running: child } : readiness;
}

async function obtainedCli(run: DevelopmentRun): Promise<string | undefined> {
  try {
    return await run.setup.obtainCli(run.log.info);
  } catch (failure) {
    run.log.warn(
      `The Temporal CLI could not be obtained (${oneLine(failure)}), so the server starts without workflows; ${howToGetWorkflows}`,
    );
    return undefined;
  }
}

async function ownTemporal(run: DevelopmentRun, local: LocalTemporal): Promise<DevelopmentTemporal | 'stopped'> {
  const cli = await obtainedCli(run);
  if (cli === undefined) {
    return withoutTemporal;
  }
  const started = await startedTemporal(run, cli, local);
  if (started === 'stopping') {
    return 'stopped';
  }
  if (!('running' in started)) {
    run.log.warn(
      `Temporal's dev server could not start (${started.ended}), so the server starts without workflows; ${howToGetWorkflows}`,
    );
    return withoutTemporal;
  }
  const address = `127.0.0.1:${local.port}`;
  const webUi = `http://127.0.0.1:${local.uiPort}`;
  run.log.info(
    `Temporal ${temporalCliVersion} is running on ${address} with its state in ${local.stateFile}; web UI at ${webUi}`,
  );
  return { address, child: started.running, workflows: `Temporal web UI at ${webUi}` };
}

export async function temporalFor(run: DevelopmentRun): Promise<DevelopmentTemporal | 'stopped'> {
  const local = run.setup.temporal;
  if (local === undefined) {
    return withoutTemporal;
  }
  if (run.settings['TEMPORAL_ADDRESS'] !== undefined) {
    run.log.info('TEMPORAL_ADDRESS is set, so no Temporal dev server is started');
    return { ...withoutTemporal, workflows: 'on the Temporal that TEMPORAL_ADDRESS names' };
  }
  const address = `127.0.0.1:${local.port}`;
  const answer = await whatAnswersOn(address);
  if (answer === 'Temporal') {
    run.log.info(`Temporal already answers on ${address}, so the server uses it`);
    return { address, child: undefined, workflows: `on the Temporal already at ${address}` };
  }
  if (answer === 'something else') {
    run.log.warn(
      `Something that is not Temporal is listening on ${address}, so the server starts without workflows; free the port and restart, or set TEMPORAL_ADDRESS, to get workflows`,
    );
    return withoutTemporal;
  }
  return ownTemporal(run, local);
}
