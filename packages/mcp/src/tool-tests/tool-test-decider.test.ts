import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolTestDecider } from './tool-test-decider.ts';

const testId = '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b';

const recorded = { test_id: testId, by: 'acme-builder', at: '2026-10-08T09:00:00.000Z' };

const started = {
  type: 'tool_test_started',
  ...recorded,
  server: 'graph',
  tool: 'search',
  arguments_bytes: 2,
  arguments_sha256: 'a',
} as const;

const answered = {
  type: 'tool_test_answered',
  ...recorded,
  outcome: 'result',
  result_bytes: 61,
  result_sha256: 'b',
  duration_ms: 3,
  jsonrpc_id: 2,
} as const;

const outOfTurn = {
  failure: {
    _tag: 'conflict',
    detail: 'A test records its start once and then its answer once, so this is not recorded',
  },
};

const afterTheStart = toolTestDecider.evolve(toolTestDecider.initialState, started);

const afterTheAnswer = toolTestDecider.evolve(afterTheStart, answered);

describe('the record of a test', () => {
  it('takes a start, and then an answer', () => {
    expect(toolTestDecider.decide(started, toolTestDecider.initialState)).toEqual(Result.succeed([started]));
    expect(toolTestDecider.decide(answered, afterTheStart)).toEqual(Result.succeed([answered]));
  });

  it('refuses an answer before the start, a second start and a second answer', () => {
    expect(toolTestDecider.decide(answered, toolTestDecider.initialState)).toMatchObject(outOfTurn);
    expect(toolTestDecider.decide(started, afterTheStart)).toMatchObject(outOfTurn);
    expect(toolTestDecider.decide(answered, afterTheAnswer)).toMatchObject(outOfTurn);
  });
});
