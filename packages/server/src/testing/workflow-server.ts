import { setTimeout } from 'node:timers/promises';

import type { ScriptedReply } from '@beonauto/inference/testing';
import { Option, Schema } from 'effect';

import type { RequestOptions, TestResponse } from './http-client.ts';
import { servingReasoning, type ReasoningServer } from './reasoning-server.ts';

export const workflowTestTimeoutMs = 60_000;

const localMode: Readonly<Record<string, string>> = { LOCAL_MODE: 'true' };

const statusOf = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

const executionOf = Schema.decodeUnknownSync(Schema.Struct({ execution_id: Schema.String }));

export function servingWorkflows(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = localMode,
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment);
}

export function workflowSource(name: string, steps: string): string {
  return `document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: ${name}\n  version: '1.0.0'\n${steps}`;
}

export function executionIdIn(body: unknown): string {
  return executionOf(body).execution_id;
}

export function isStarted(body: unknown): boolean {
  return Option.getOrUndefined(statusOf(body))?.status === 'started';
}

export async function settledExecution(
  server: ReasoningServer,
  path: string,
  options: RequestOptions = {},
): Promise<TestResponse> {
  const response = await server.call('GET', path, options);
  if (!isStarted(response.body)) {
    return response;
  }
  await setTimeout(100);
  return settledExecution(server, path, options);
}
