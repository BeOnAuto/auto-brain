import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { inject, onTestFinished } from 'vitest';

import {
  localTemporalPorts,
  runnerLines,
  untilListening,
  untilWritten,
  type Development,
  type LocalTemporalPorts,
} from './development-process.ts';
import { acceptedOnceUp, requestTo, settledOver } from './workflow-process.ts';
import { executionIdIn, workflowSource } from './workflow-server.ts';

export interface Stopped {
  readonly exitCode: unknown;
  readonly said: readonly string[];
}

export const howToGetWorkflows =
  'to get workflows, run `temporal server start-dev` and restart, or set TEMPORAL_ADDRESS';

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

const notOffered = /"message":"Workflows are not offered because TEMPORAL_ADDRESS is unset"/u;

export async function greetingSettled(port: number): Promise<unknown> {
  await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
  await requestTo(port, 'POST', '/alpha/specs/orchestration', { name: 'greeting', source: greeting });
  const started = await acceptedOnceUp(port, '/alpha/specs/orchestration/greeting/execute', {
    input: { name: 'Ada' },
  });
  return settledOver(port, `/alpha/executions/${executionIdIn(started.body)}`);
}

export async function stoppedWith(development: Development, signal: NodeJS.Signals): Promise<Stopped> {
  development.signal(signal);
  return { exitCode: await development.exited, said: runnerLines(development) };
}

export async function servedWithoutWorkflows(development: Development): Promise<Stopped> {
  await untilListening(development);
  await untilWritten(development.stderr, notOffered);
  return stoppedWith(development, 'SIGTERM');
}

export async function webUiAnswer(url: string): Promise<number> {
  const { status } = await fetch(url);
  return status;
}

export async function notTemporalOn(port: number): Promise<void> {
  const server = createServer().listen(port, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
}

export function temporalElsewhere(): Readonly<Record<string, string>> {
  return { TEMPORAL_ADDRESS: inject('temporalAddress'), TEMPORAL_TASK_QUEUE: `development-${randomUUID()}` };
}

export async function startedNothing(start: (temporal: LocalTemporalPorts) => Development): Promise<unknown> {
  const temporal = await localTemporalPorts();
  await notTemporalOn(temporal.port);
  const development = start(temporal);
  const settled = await greetingSettled(await untilListening(development));
  return { settled, ...(await stoppedWith(development, 'SIGTERM')) };
}
