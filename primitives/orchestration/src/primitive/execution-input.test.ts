import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { brainWith } from '../testing/brain.ts';
import type { OrchestrationClient } from './orchestration-client.ts';
import { makeOrchestration } from './orchestration-primitive.ts';

const neverStarted: OrchestrationClient = {
  mostDuration: 30 * 24 * 3_600_000,
  start: () => Effect.die('A workflow started'),
  signal: () => Effect.die('An event was sent'),
};

const flow = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n`;

function nested(depth: number): Json {
  return depth === 0 ? 'bottom' : [nested(depth - 1)];
}

async function executing(input: Json) {
  const brain = brainWith([makeOrchestration({ client: neverStarted })]);
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'flow', source: flow });
  return brain.call(brain.executeSpec, { primitive: 'orchestration', name: 'flow', input });
}

describe('executing a workflow spec with an input a workflow may not hold', () => {
  it('is rejected for an input that nests more than 512 levels deep, before a workflow starts', async () => {
    expect(await executing({ deep: nested(512) })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input nests more than 512 levels deep',
      issues: [{ detail: 'The input nests more than 512 levels deep', pointer: '/input' }],
    });
  });

  it('checks its document against the most a workflow may run that its client was set with', async () => {
    const brain = brainWith([makeOrchestration({ client: { ...neverStarted, mostDuration: 10_800_000 } })]);
    const source = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: [{ pause: { wait: PT4H } }]\n`;

    expect(await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'flow', source })).toMatchObject({
      status: 'rejected',
      issues: [
        {
          detail:
            'Line 2, column 23: at /do/0/pause/wait: This duration, 14400000 ms, is longer than the 10800000 ms a workflow may run',
        },
      ],
    });
  });

  it('starts a workflow for an input that nests 512 levels deep', async () => {
    expect(await executing({ deep: nested(511) })).toMatchObject({ status: 'failed' });
  });
});
