import { toolTestPresenter } from '@beonauto/mcp';
import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { isReservedSource, refusingTheBrainsOwnAttributes, reservedEventTypes } from './reserved-attributes.ts';

const EventSchema = Schema.Struct({
  type: Schema.String,
  source: Schema.optionalKey(Schema.String),
  causationid: Schema.optionalKey(Schema.String),
  correlationid: Schema.optionalKey(Schema.String),
}).check(refusingTheBrainsOwnAttributes);

const decode = Schema.decodeUnknownResult(EventSchema, { errors: 'all' });

function refusals(event: unknown): readonly string[] {
  const decoded = decode(event);
  return Result.isSuccess(decoded)
    ? []
    : SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue).issues.map(
        ({ message, path = [] }) => `/${path.map(String).join('/')}: ${message}`,
      );
}

const typesOfTheBrain = [
  'run_started',
  'run_deferred',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'delivery_started',
  'delivery_ended',
  'reply_taken',
  'reply_refused',
  'tool_test_started',
  'tool_test_answered',
  'replies_read',
  'telling_started',
  'telling_ended',
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

describe('the types and sources of what the brain records itself', () => {
  it('are reserved for the brain: every type its runs and definitions record, and every type its feed shows', () => {
    expect([...reservedEventTypes]).toEqual(typesOfTheBrain);
    const shown = [...makeDefinitionPresenters([echo]), toolTestPresenter].flatMap(({ publicNames }) =>
      Object.values(publicNames).flat(),
    );
    expect(shown.filter((name) => !reservedEventTypes.has(name))).toEqual([]);
    expect(
      ['/runs/1', '/definitions/reasoning/summary', '/callers/acme-admin', '/runs', 'runs/1', '/ledger/eu'].map(
        (source) => isReservedSource(source),
      ),
    ).toEqual([true, true, true, false, false, false]);
  });

  it('are refused in an event from outside, each where it is given', () => {
    expect(refusals({ type: 'run_succeeded', source: '/runs/0199a3c4' })).toEqual([
      `/type: Expected a type of your own, not one the brain records itself: ${typesOfTheBrain.join(', ')}`,
      '/source: Expected a source of your own, not one under /runs/, /definitions/ or /callers/, which the brain records itself',
    ]);
    expect(
      [
        'run_deferred',
        'tool_call_started',
        'tool_test_started',
        'tool_test_answered',
        'reply_taken',
        'reply_refused',
        'replies_read',
        'telling_started',
        'telling_ended',
        'event_published',
        'workflow_input_applied',
        'step_waiting',
      ].map((type) => refusals({ type }).length),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(refusals({ type: 'com.acme.ledger.month-closed', source: '/ledger/eu' })).toEqual([]);
  });
});

describe('the lineage the brain gives its own records', () => {
  it('is refused in an event from outside, which may not claim it', () => {
    expect(refusals({ type: 'com.acme.approved', causationid: 'm-1', correlationid: 'r-1' })).toEqual([
      '/causationid: Expected no causationid: causationid and correlationid are the lineage the brain gives its own records, which no event may claim',
      '/correlationid: Expected no correlationid: causationid and correlationid are the lineage the brain gives its own records, which no event may claim',
    ]);
  });
});
