import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeSpecPresenters } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { isReservedSource, refusingTheBrainsOwnAttributes, reservedEventTypes } from './reserved-attributes.ts';

const EventSchema = Schema.Struct({
  type: Schema.String,
  source: Schema.optionalKey(Schema.String),
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

describe('the types and sources of what the brain records itself', () => {
  it('are reserved for the brain: every type its runs and definitions record, and every type its feed shows', () => {
    expect([...reservedEventTypes]).toEqual([
      'execution_started',
      'execution_deferred',
      'execution_succeeded',
      'execution_rejected',
      'execution_failed',
      'tool_call_started',
      'tool_call_answered',
      'spec_created',
      'spec_updated',
      'spec_retired',
      'event_published',
      'workflow_input_applied',
      'step_started',
      'step_waiting',
      'step_finished',
      'step_failed',
      'step_skipped',
      'reaction_refused',
    ]);
    const shown = makeSpecPresenters([echo]).flatMap(({ publicNames }) => Object.values(publicNames).flat());
    expect(shown.filter((name) => !reservedEventTypes.has(name))).toEqual([]);
    expect(
      [
        '/executions/1',
        '/specs/inference/summary',
        '/callers/acme-admin',
        '/executions',
        'executions/1',
        '/ledger/eu',
      ].map((source) => isReservedSource(source)),
    ).toEqual([true, true, true, false, false, false]);
  });

  it('are refused in an event from outside, each where it is given', () => {
    expect(refusals({ type: 'execution_succeeded', source: '/executions/0199a3c4' })).toEqual([
      '/type: Expected a type of your own, not one the brain records itself: execution_started, execution_deferred, execution_succeeded, execution_rejected, execution_failed, tool_call_started, tool_call_answered, spec_created, spec_updated, spec_retired, event_published, workflow_input_applied, step_started, step_waiting, step_finished, step_failed, step_skipped, reaction_refused',
      '/source: Expected a source of your own, not one under /executions/, /specs/ or /callers/, which the brain records itself',
    ]);
    expect(
      ['execution_deferred', 'tool_call_started', 'event_published', 'workflow_input_applied', 'step_waiting'].map(
        (type) => refusals({ type }).length,
      ),
    ).toEqual([1, 1, 1, 1, 1]);
    expect(refusals({ type: 'com.acme.ledger.month-closed', source: '/ledger/eu' })).toEqual([]);
  });
});
