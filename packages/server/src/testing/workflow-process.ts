import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

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

export function workflowProcess(ledgerFile: string, environment: Readonly<Record<string, string>> = {}): SpawnedServer {
  return spawnServer(mainModule, {
    HOME: homedir(),
    HOST: '127.0.0.1',
    PORT: '0',
    LOCAL_MODE: 'true',
    LEDGER_FILE: ledgerFile,
    ...environment,
  });
}

export function logLinesOf(child: SpawnedServer): readonly LogLine[] {
  return child
    .output()
    .stderr.split('\n')
    .filter((line) => line !== '')
    .map((line) => decodeLine(line));
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
