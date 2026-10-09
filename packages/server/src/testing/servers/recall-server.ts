import { answers, jsonResult, type ScriptedReply } from '@beonauto/reasoning/testing';
import { campaignReviews } from '@beonauto/recall/testing';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Option, Schema } from 'effect';
import { expect, vi } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../../composition/served-computation.ts';
import { alpha, servingReasoning, type ReasoningServer } from './reasoning-server.ts';

export const recallTestTimeoutMs = 60_000;

const untilNearTheTestTimeout = { timeout: recallTestTimeoutMs - 10_000, interval: 50 };

export const anyReview = [
  '---',
  'description: Reviews a campaign brief, answering whatever the model writes',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  '  schema: {type: [object, array, string]}',
  '---',
  'Review this campaign brief and give the campaign and your verdict: {{ input.brief }}',
].join('\n');

const StandingSchema = Schema.Struct({
  standing: Schema.Struct({ state: Schema.String, version: Schema.Number, folded: Schema.Number }),
});

export type Standing = typeof StandingSchema.Type.standing;

const decodeStanding = Schema.decodeUnknownOption(StandingSchema);

export function verdicts(...outputs: readonly Schema.Json[]): readonly ScriptedReply[] {
  return outputs.map((output) => answers(jsonResult(output)));
}

export interface Gate {
  readonly poolOf: ProgramPoolOf;
  readonly letThrough: (folds: number) => void;
  readonly open: () => void;
  readonly held: () => number;
}

export function foldsHeldUntilOpened(): Gate {
  const waiting: (() => void)[] = [];
  const allowed = { folds: 0 };
  const released = (): void => {
    const ready = waiting.splice(0, Math.min(allowed.folds, waiting.length));
    allowed.folds -= ready.length;
    for (const go of ready) {
      go();
    }
  };
  const held = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    fold: async (request, signal) => {
      const turn = Promise.withResolvers<void>();
      waiting.push(turn.resolve);
      released();
      await turn.promise;
      return pool.fold(request, signal);
    },
  });
  return {
    poolOf: (settings) => held(workerPool(settings)),
    letThrough: (folds) => {
      allowed.folds += folds;
      released();
    },
    open: () => {
      allowed.folds = Number.POSITIVE_INFINITY;
      released();
    },
    held: () => waiting.length,
  };
}

export function foldsHeld(gate: Gate, folds: number): Promise<void> {
  return vi.waitFor(() => {
    expect(gate.held()).toBe(folds);
  }, untilNearTheTestTimeout);
}

export async function brainWithReviews(server: ReasoningServer, briefsFirst = 0, brain = 'alpha'): Promise<void> {
  const path = `/v1/orgs/acme/brains/${brain}`;
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain, name: brain } });
  await server.call('POST', `${path}/definitions/reasoning`, { body: { name: 'review-brief', source: anyReview } });
  await reviewed(server, briefsFirst, brain);
  await server.call('POST', `${path}/definitions/recall`, { body: { name: 'reviews', source: campaignReviews } });
}

export function reviewed(server: ReasoningServer, briefs: number, brain = 'alpha'): Promise<unknown> {
  return Array.from({ length: briefs }, (_, index) => index).reduce<Promise<unknown>>(
    (before, index) =>
      before.then(() =>
        server.call('POST', `/v1/orgs/acme/brains/${brain}/definitions/reasoning/review-brief/run`, {
          body: { input: { brief: `brief ${index}` } },
        }),
      ),
    Promise.resolve(),
  );
}

export function recalled(server: ReasoningServer, name: string, input: Schema.Json) {
  return server.call('POST', `${alpha}/definitions/recall/${name}/run`, { body: { input } });
}

export function standingUntil(
  server: ReasoningServer,
  name: string,
  holds: (standing: Standing) => boolean,
): Promise<unknown> {
  return vi.waitFor(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/recall/${name}`);
    const standing = Option.getOrUndefined(decodeStanding(body))?.standing;
    expect(standing !== undefined && holds(standing)).toBe(true);
    return body;
  }, untilNearTheTestTimeout);
}

export function liveWith(folded: number): (standing: Standing) => boolean {
  return (standing) => standing.state === 'live' && standing.folded === folded;
}

export function liveAt(version: number): (standing: Standing) => boolean {
  return (standing) => standing.state === 'live' && standing.version === version;
}

export function inState(state: string): (standing: Standing) => boolean {
  return (standing) => standing.state === state;
}

export function servingRecall(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = {},
  programPoolOf: ProgramPoolOf = workerPool,
): Promise<ReasoningServer> {
  return servingReasoning(replies, { LOCAL_MODE: 'true', ...environment }, undefined, { programPoolOf });
}
