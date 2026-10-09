import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cancelRequestOf, lastEndingOf, runEndingOf } from '../index.ts';
import { RunEventSchema, type RunEvent } from './run-events.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(RunEventSchema));

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:00.000Z' };

const ofCheck = { definition_type: 'workflow', name: 'check', definition_version: 1 };

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

const started: RunEvent = { type: 'run_started', ...ofCheck, input: {}, called_by: calledBy, ...fact };

const succeeded: RunEvent = {
  type: 'run_succeeded',
  output: 'done',
  record: {},
  ...ofCheck,
  called_by: calledBy,
  ...fact,
};

const cancelAsked: RunEvent = {
  type: 'run_cancel_requested',
  kind: 'deadline',
  reason: 'Out',
  ...ofCheck,
  ...fact,
};

describe('the ending of a run, read from its record', () => {
  it('is a success, a rejection or a failure with the call it answers, and nothing for any other record', () => {
    expect([runEndingOf(encode(succeeded)), runEndingOf(encode(started)), runEndingOf({ type: 'nonsense' })]).toEqual([
      succeeded,
      undefined,
      undefined,
    ]);
  });

  it('is the last record of a run that ended, and nothing for a run still going', () => {
    expect([
      lastEndingOf([encode(started), encode(succeeded)]),
      lastEndingOf([encode(started), encode(succeeded), encode(started)]),
      lastEndingOf([]),
    ]).toEqual([succeeded, undefined, undefined]);
  });
});

describe('a cancel request, read from its record', () => {
  it('is the request with its kind and reason, and nothing for any other record', () => {
    expect([cancelRequestOf(encode(cancelAsked)), cancelRequestOf(encode(succeeded))]).toEqual([
      cancelAsked,
      undefined,
    ]);
  });
});
