import { setTimeout } from 'node:timers/promises';

import type { McpSession, ToolResult } from '@beonauto/api/testing';
import type { ScriptedReply } from '@beonauto/inference/testing';
import type { HostClock } from '@beonauto/workflow-host';
import { Option, Schema } from 'effect';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import type { RequestOptions, TestResponse } from './http-client.ts';
import { servingReasoning, type ReasoningServer } from './reasoning-server.ts';

export const workflowTestTimeoutMs = 60_000;

const localMode: Readonly<Record<string, string>> = { LOCAL_MODE: 'true' };

const statusOf = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

const executionOf = Schema.decodeUnknownSync(Schema.Struct({ execution_id: Schema.String }));

export function servingWorkflows(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = localMode,
  programPoolOf?: ProgramPoolOf,
  clock?: HostClock,
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment, undefined, {
    ...(programPoolOf === undefined ? {} : { programPoolOf }),
    ...(clock === undefined ? {} : { clock }),
  });
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

export async function settledOverMcp(session: McpSession, executionId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_execution', { execution_id: executionId });
  if (!isStarted(reading.structuredContent)) {
    return reading;
  }
  await setTimeout(100);
  return settledOverMcp(session, executionId);
}
