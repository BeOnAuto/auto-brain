import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle/lifecycle.ts';
import { spawnServer, type SpawnedServer } from './spawned-server.ts';
import { executionIdIn, isStarted, workflowSource } from './workflow-server.ts';

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

const welcome = ['---', 'model: stub/writer', '---', 'Welcome {{ input.name }}.'].join('\n');

const welcoming = workflowSource(
  'welcoming',
  "do:\n  - welcome: { call: execute_spec, with: { primitive: inference, name: welcome, input: { name: '${ .name }' } } }\n",
);

export interface StubGateway {
  readonly gateways: string;
  readonly requests: () => number;
  readonly firstHeard: Promise<void>;
}

function answered(response: ServerResponse): void {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 1_790_000_000,
      model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Welcome, Ada.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }),
  );
}

export async function gatewayThatHangsFirst(): Promise<StubGateway> {
  const heard = Promise.withResolvers<void>();
  const counted = { requests: 0 };
  const server = createServer((request, response) => {
    counted.requests += 1;
    request.resume();
    if (counted.requests === 1) {
      heard.resolve();
      return;
    }
    answered(response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    gateways: JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]),
    requests: () => counted.requests,
    firstHeard: heard.promise,
  };
}

export async function welcomingStarted(port: number, brain: string): Promise<string> {
  await requestTo(port, 'POST', '', { brain, name: 'Welcoming' });
  await requestTo(port, 'POST', `/${brain}/specs/inference`, { name: 'welcome', source: welcome });
  await requestTo(port, 'POST', `/${brain}/specs/orchestration`, { name: 'welcoming', source: welcoming });
  const started = await requestTo(port, 'POST', `/${brain}/specs/orchestration/welcoming/execute`, {
    input: { name: 'Ada' },
  });
  return executionIdIn(started.body);
}
