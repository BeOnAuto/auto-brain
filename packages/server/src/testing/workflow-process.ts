import { once } from 'node:events';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { tcpPort } from '../lifecycle.ts';
import { spawnServer, type SpawnedServer } from './spawned-server.ts';
import { isStarted } from './workflow-server.ts';

export interface LogLine {
  readonly message: string;
  readonly level: string;
  readonly annotations: Readonly<Record<string, unknown>>;
}

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
);

export function workflowProcess(ledgerFile: string, address: string, taskQueue: string): SpawnedServer {
  return spawnServer(mainModule, {
    HOME: homedir(),
    HOST: '127.0.0.1',
    PORT: '0',
    LOCAL_MODE: 'true',
    LEDGER_FILE: ledgerFile,
    TEMPORAL_ADDRESS: address,
    TEMPORAL_TASK_QUEUE: taskQueue,
  });
}

export function logLinesOf(child: SpawnedServer): readonly LogLine[] {
  return child
    .output()
    .stderr.split('\n')
    .filter((line) => line !== '')
    .map((line) => decodeLine(line));
}

export async function untilLogged(child: SpawnedServer, wanted: (message: string) => boolean): Promise<void> {
  if (logLinesOf(child).some(({ message }) => wanted(message))) {
    return;
  }
  await setTimeout(50);
  await untilLogged(child, wanted);
}

export async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = tcpPort(probe.address());
  probe.close();
  return port;
}

export async function requestTo(port: number, method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme/brains${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function eventually(attempt: () => Promise<Answer>, done: (answer: Answer) => boolean): Promise<Answer> {
  const answer = await attempt();
  if (done(answer)) {
    return answer;
  }
  await setTimeout(100);
  return eventually(attempt, done);
}

export async function settledOver(port: number, path: string): Promise<unknown> {
  const { body } = await eventually(
    () => requestTo(port, 'GET', path),
    (answer) => !isStarted(answer.body),
  );
  return body;
}

export function acceptedOnceUp(port: number, path: string, body: unknown): Promise<Answer> {
  return eventually(
    () => requestTo(port, 'POST', path, body),
    ({ status }) => status === 200,
  );
}
