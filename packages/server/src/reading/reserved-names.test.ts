import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const reservedWhileARepliesFactWasTheBrains = [
  'run_started',
  'run_deferred',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'delivery_started',
  'delivery_succeeded',
  'delivery_failed',
  'delivery_refused',
  'reply_taken',
  'reply_refused',
  'tool_test_started',
  'tool_test_answered',
  'tool_test_failed',
  'replies_read',
  'reading_failed',
  'telling_started',
  'telling_succeeded',
  'telling_failed',
  'interaction_requested',
  'definition_created',
  'definition_updated',
  'definition_retired',
  'event_published',
  'workflow_input_applied',
  'step_started',
  'step_waiting',
  'step_finished',
  'step_failed',
  'step_skipped',
  'reaction_refused',
];

const reserved = [
  'run_started',
  'run_deferred',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'request_answered',
  'delivery_started',
  'delivery_succeeded',
  'delivery_failed',
  'delivery_refused',
  'reply_refused',
  'telling_started',
  'telling_succeeded',
  'telling_failed',
  'replies_read',
  'reading_failed',
  'interaction_requested',
  'tool_test_started',
  'tool_test_answered',
  'tool_test_failed',
  'definition_created',
  'definition_updated',
  'definition_retired',
  'event_published',
  'workflow_input_applied',
  'step_started',
  'step_waiting',
  'step_finished',
  'step_failed',
  'step_skipped',
  'reaction_refused',
];

const reservedOnceTheAnswerIsAFact = [
  ...reservedWhileARepliesFactWasTheBrains.filter((type) => type !== 'reply_taken'),
  'request_answered',
].toSorted();

const ofTheBrain = 'Expected a type of your own, not one the brain records itself: ';

const decodeRefusal = Schema.decodeUnknownSync(
  Schema.Struct({
    reason: Schema.Literal('invalid_input'),
    errors: Schema.NonEmptyArray(Schema.Struct({ pointer: Schema.Literal('/event/type'), detail: Schema.String })),
  }),
);

describe('the types a business may not publish to its brain', () => {
  it('are the facts the brain records and those its capabilities declare: the list before, with request_answered for reply_taken', async () => {
    const server = await servingReasoning([]);
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });

    const refused = await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger/eu', type: 'request_answered' } },
    });
    const [{ detail }] = decodeRefusal(refused.body).errors;
    const named = detail.replace(ofTheBrain, '').split(', ');

    expect(refused.status).toBe(422);
    expect(named).toEqual(reserved);
    expect(named.toSorted()).toEqual(reservedOnceTheAnswerIsAFact);
  });
});
