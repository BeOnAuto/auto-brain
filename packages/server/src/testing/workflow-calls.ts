import { setTimeout } from 'node:timers/promises';

import type { ScriptedReply } from '@beonauto/inference/testing';
import { Schema } from 'effect';

import type { TestResponse } from './http-client.ts';
import { alpha, type ReasoningServer } from './reasoning-server.ts';
import { servingWorkflows, workflowSource } from './workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

function calling(name: string, task: string, indent = '  '): string {
  return `${indent}- ${task}: { call: execute_spec, with: { primitive: orchestration, name: ${name} } }\n`;
}

export const workflows: Readonly<Record<string, string>> = {
  asking:
    "do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: summary, input: { text: 'long' } } }\n",
  nesting: `do:\n${calling('asking', 'nest')}`,
  pending: 'do:\n  - hold: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n',
  waiting: `do:\n${calling('pending', 'wait')}`,
  middle: `do:\n${calling('pending', 'wait')}`,
  top: `do:\n${calling('middle', 'wait')}`,
  quick: 'do:\n  - done: { set: { quick: true } }\n',
  deep: `do:\n${calling('deep', 'again')}`,
  guarded: `do:
  - guard:
      try:
${calling('pending', 'wait', '        ')}      catch:
        errors: { with: { type: https://on.auto/problems/cancelled, kind: requested } }
        do:
          - note: { set: { caught: '\${ $error.kind }' } }
`,
  impatient: `do:
  - wait:
      call: execute_spec
      with: { primitive: orchestration, name: pending }
      timeout: { after: { milliseconds: 500 } }
`,
  wide: `do:
  - each:
      fork:
        branches:
${['a', 'b', 'c'].map((branch) => calling('pending', branch, '          ')).join('')}`,
};

async function definedInTurn(server: ReasoningServer, entries: readonly (readonly [string, string])[]): Promise<void> {
  const [entry, ...rest] = entries;
  if (entry !== undefined) {
    const [name, steps] = entry;
    await server.call('POST', `${alpha}/specs/orchestration`, { body: { name, source: workflowSource(name, steps) } });
    await definedInTurn(server, rest);
  }
}

export async function servingCalls(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = {},
): Promise<ReasoningServer> {
  const server = await servingWorkflows(replies, { LOCAL_MODE: 'true', ...environment });
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  await definedInTurn(server, Object.entries(workflows));
  return server;
}

export function startedRunOf(server: ReasoningServer, name: string): Promise<TestResponse> {
  return server.call('POST', `${alpha}/specs/orchestration/${name}/execute`, { body: { input: {} } });
}

const ListedRuns = Schema.Struct({
  executions: Schema.Array(
    Schema.Struct({
      execution_id: Schema.String,
      status: Schema.String,
      rejection: Schema.optionalKey(Schema.Struct({ kind: Schema.optionalKey(Schema.String) })),
    }),
  ),
});

export type ListedRun = (typeof ListedRuns.Type)['executions'][number];

const decodeListed = Schema.decodeUnknownSync(ListedRuns);

export async function runsOf(server: ReasoningServer, name: string): Promise<readonly ListedRun[]> {
  const listed = await server.call('GET', `${alpha}/executions?primitive=orchestration&name=${name}&limit=100`);
  return decodeListed(listed.body).executions;
}

export async function until<A>(attempt: () => Promise<A>, done: (value: A) => boolean): Promise<A> {
  const value = await attempt();
  if (done(value)) {
    return value;
  }
  await setTimeout(50);
  return until(attempt, done);
}

export function ended(runs: readonly ListedRun[]): boolean {
  return runs.length > 0 && runs.every(({ status }) => status !== 'started');
}
