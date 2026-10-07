import { approvalDocument, notificationDocument } from '@beonauto/interaction/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from './reasoning-server.ts';
import { until } from './workflow-calls.ts';
import { executionIdIn, settledExecution, workflowSource } from './workflow-server.ts';

export const brief = { campaign: 'Spring', owner: 'ada' };

export const unansweredType = 'https://on.auto/problems/unanswered';

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ execution_id: Schema.String })) }),
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, causation_id: Schema.NullOr(Schema.String) }),
    ),
  }),
);

function causesIn(history: unknown): readonly (readonly [string, string | null | undefined])[] {
  const { events } = decodeHistory(history);
  const typeOf = new Map(events.map(({ id, type }) => [id, type]));
  return events.map(({ type, causation_id: cause }) => [type, cause === null ? null : typeOf.get(cause)]);
}

export interface InteractionServer extends ReasoningServer {
  readonly ask: (name: string) => Promise<string>;
  readonly answer: (runId: string, body: unknown, authorization?: string) => ReturnType<ReasoningServer['call']>;
  readonly settled: (runId: string) => Promise<unknown>;
  readonly workflow: (name: string, steps: string) => Promise<string>;
  readonly openRequests: (count: number) => Promise<readonly string[]>;
  readonly causes: (runId: string) => Promise<readonly (readonly [string, string | null | undefined])[]>;
}

function once(stop: () => Promise<void>): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= stop();
    return stopping;
  };
}

export async function interactionServerOn(environment: Readonly<Record<string, string>>): Promise<InteractionServer> {
  const server = await servingReasoning([], { LOCAL_MODE: 'true', ...environment });
  const stop = once(server.stop);
  onTestFinished(stop);
  return {
    ...server,
    stop,
    ask: async (name) => {
      const started = await server.call('POST', `${alpha}/specs/interaction/${name}/execute`, {
        body: { input: brief },
      });
      return executionIdIn(started.body);
    },
    answer: (runId, body, authorization) =>
      server.call('POST', `${alpha}/executions/${runId}/answer`, {
        body,
        ...(authorization === undefined ? {} : { authorization }),
      }),
    settled: async (runId) => (await settledExecution(server, `${alpha}/executions/${runId}`)).body,
    workflow: async (name, steps) => {
      await server.call('POST', `${alpha}/specs/orchestration`, {
        body: { name, source: workflowSource(name, steps) },
      });
      const started = await server.call('POST', `${alpha}/specs/orchestration/${name}/execute`, {
        body: { input: {} },
      });
      return executionIdIn(started.body);
    },
    openRequests: async (count) => {
      const listed = await until(
        async () => decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions,
        (interactions) => interactions.length >= count,
      );
      return listed.map(({ execution_id: runId }) => runId);
    },
    causes: async (runId) => causesIn((await server.call('GET', `${alpha}/executions/${runId}/history`)).body),
  };
}

export async function servingInteractions(
  channel: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<InteractionServer> {
  const server = await interactionServerOn(environment);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/interaction`, {
    body: { name: 'approve-brief', source: approvalDocument(channel) },
  });
  await server.call('POST', `${alpha}/specs/interaction`, {
    body: { name: 'brief-out', source: notificationDocument(channel) },
  });
  return server;
}

export function asking(name: string, task: string, indent = '  '): string {
  return `${indent}- ${task}: { call: execute_spec, with: { primitive: interaction, name: ${name}, input: { campaign: Spring, owner: ada } } }\n`;
}

export function guarded(name: string, kind: string): string {
  return `do:
  - guard:
      try:
${asking(name, 'ask', '        ')}      catch:
        errors: { with: { type: ${unansweredType}, kind: ${kind} } }
        do:
          - note: { set: { caught: '\${ $error.kind }' } }
`;
}
