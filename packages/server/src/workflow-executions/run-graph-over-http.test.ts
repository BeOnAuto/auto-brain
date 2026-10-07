import { internalTermsIn } from '@beonauto/api/testing';
import { answers, jsonResult } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/servers/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const review = workflowSource(
  'review',
  `do:
  - judge:
      call: execute_spec
      with: { primitive: inference, name: verdict, input: { expense: '\${ .expense }' } }
  - route:
      switch:
        - approved: { when: .approve == true, then: accept }
        - declined: { then: decline }
  - accept: { set: { approved: true }, then: end }
  - decline: { set: { approved: false } }
`,
);

const EventSchema = Schema.Struct({
  id: Schema.String,
  cursor: Schema.String,
  causation_id: Schema.NullOr(Schema.String),
  type: Schema.String,
  summary: Schema.String,
  data: Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    execution_id: Schema.optionalKey(Schema.String),
  }),
});

type Event = typeof EventSchema.Type;

const pageOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(EventSchema),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function reviewed(): Promise<string> {
  server = await servingWorkflows([answers(jsonResult({ approve: false }))]);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'verdict', source: verdict } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'review', source: review } });
  const started = await server.call('POST', `${alpha}/specs/orchestration/review/execute`, {
    body: { input: { expense: 'a yacht' } },
  });
  const executionId = executionIdIn(started.body);
  await settledExecution(server, `${alpha}/executions/${executionId}`);
  return executionId;
}

async function everyEvent(path: string, cursor?: string): Promise<readonly Event[]> {
  const query = cursor === undefined ? '' : `&cursor=${cursor}`;
  const page = pageOf((await server.call('GET', `${path}${query}`)).body);
  return page.next_cursor === null ? page.events : [...page.events, ...(await everyEvent(path, page.next_cursor))];
}

function startOf(events: readonly Event[], executionId: string): Event | undefined {
  return events.find(({ type, data }) => type === 'execution_started' && data.execution_id === executionId);
}

function named(events: readonly Event[], type: string, name?: string): Event {
  const found = events.find((event) => event.type === type && (name === undefined || event.data.name === name));
  if (found === undefined) {
    throw new Error(`No ${type} ${name ?? ''} among the events`);
  }
  return found;
}

describe('the graph of a workflow run, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('names every event and its cause, from the start through each step to the finish', async () => {
    const executionId = await reviewed();
    const events = await everyEvent(`${alpha}/executions/${executionId}/history?limit=100`);
    const started = named(events, 'execution_started');
    const [first, second] = events.filter(({ type }) => type === 'workflow_input_applied');

    expect([
      started.causation_id,
      first?.causation_id,
      named(events, 'step_waiting', 'judge').causation_id,
      second?.causation_id,
      named(events, 'step_finished', 'judge').causation_id,
      named(events, 'step_finished', 'route').causation_id,
      named(events, 'step_finished', 'decline').causation_id,
      named(events, 'execution_succeeded').causation_id,
    ]).toEqual([
      null,
      started.id,
      first?.id,
      named(events, 'step_waiting', 'judge').id,
      named(events, 'step_waiting', 'judge').id,
      named(events, 'step_finished', 'judge').id,
      named(events, 'step_finished', 'route').id,
      named(events, 'step_finished', 'decline').id,
    ]);
    expect(events.slice(0, 3).map(({ type }) => type)).toEqual([
      'execution_started',
      'workflow_input_applied',
      'step_waiting',
    ]);
    expect(events.filter(({ type }) => type === 'step_started')).toEqual([]);
    expect(events.map(({ type }) => type)).not.toContain('execution_deferred');
    expect(events.flatMap(({ summary }) => internalTermsIn(summary))).toEqual([]);
  });
});

describe('the tree of a workflow run, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('reads the whole tree of a run in the feed, its child started by the waiting step, and nothing for the child', async () => {
    const executionId = await reviewed();
    const tree = await everyEvent(`${alpha}/events?execution_id=${executionId}&order=asc&limit=100`);
    const waiting = named(tree, 'step_waiting', 'judge');
    const child = String(waiting.data.execution_id);
    const ofChild = await everyEvent(`${alpha}/events?execution_id=${child}&limit=100`);
    const childStarted = startOf(tree, child);

    expect(childStarted?.causation_id).toBe(waiting.id);
    expect(tree.filter(({ data }) => data.execution_id === child).map(({ type }) => type)).toEqual([
      'step_waiting',
      'execution_started',
      'execution_succeeded',
    ]);
    expect(ofChild).toEqual([]);
  });

  it('is never given by the input of execute_spec, which refuses a lineage', async () => {
    await reviewed();

    const refused = await server.call('POST', `${alpha}/specs/orchestration/review/execute`, {
      body: { input: {}, lineage: { causationId: null, correlationId: 'mine' } },
    });

    expect(refused).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ detail: 'Expected no excess property', pointer: '/lineage' }] },
    });
  });
});

describe('the pages of a workflow run, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('reads on from the cursor of an input in either order, the steps of that input first oldest first', async () => {
    const executionId = await reviewed();
    const tree = await everyEvent(`${alpha}/events?execution_id=${executionId}&order=asc&limit=100`);
    const at = tree.findLastIndex(({ type }) => type === 'workflow_input_applied');
    const input = tree[at];
    const after = await everyEvent(`${alpha}/events?execution_id=${executionId}&order=asc&limit=100`, input?.cursor);
    const before = await everyEvent(`${alpha}/events?execution_id=${executionId}&order=desc&limit=100`, input?.cursor);

    expect([after, before]).toEqual([tree.slice(at + 1), tree.slice(0, at).toReversed()]);
    expect(after[0]?.type).toBe('step_finished');
  });

  it('pages the history by events in the order recorded, ends inside an input, and reads on with nothing lost or repeated', async () => {
    const executionId = await reviewed();
    const whole = await everyEvent(`${alpha}/executions/${executionId}/history?limit=100`);
    const byTwo = await everyEvent(`${alpha}/executions/${executionId}/history?limit=2`);
    const newestFirst = await everyEvent(`${alpha}/executions/${executionId}/history?order=desc&limit=3`);

    expect(byTwo.map(({ id }) => id)).toEqual(whole.map(({ id }) => id));
    expect(newestFirst.map(({ id }) => id)).toEqual(whole.map(({ id }) => id).toReversed());
    expect(new Set(byTwo.map(({ id }) => id)).size).toBe(whole.length);
  });
});
