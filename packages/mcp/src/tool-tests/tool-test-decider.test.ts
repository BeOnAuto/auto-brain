import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolTestCalls, toolTestDecider } from './tool-test-decider.ts';
import type { ToolTestEvent } from './tool-test-events.ts';

const testId = '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b';

const context = { by: 'acme-builder', at: '2026-10-08T09:00:00.000Z' };

const calls = toolTestCalls(testId);

const started = calls.started({
  call_id: testId,
  server: 'graph',
  tool: 'search',
  arguments_bytes: 2,
  arguments_sha256: 'a',
  content_kept: true,
});

const answered = calls.ended({
  type: 'tool_call_answered',
  data: { is_error: false, result_bytes: 61, result_sha256: 'b', content_kept: true, duration_ms: 3, jsonrpc_id: 2 },
});

const failed = calls.ended({
  type: 'tool_call_failed',
  data: { because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 3 },
});

const outOfTurn = {
  failure: {
    _tag: 'conflict',
    detail: 'A test records its start once and then how it ended once, so this is not recorded',
  },
};

function after(...events: readonly ToolTestEvent[]) {
  return events.reduce(
    (state, event) => toolTestDecider.evolve(state, { ...event, context }),
    toolTestDecider.initialState,
  );
}

describe('the record of a test', () => {
  it('is the facts of the call, named for the test', () => {
    expect([started, answered, failed]).toEqual([
      {
        type: 'tool_test_started',
        data: {
          test_id: testId,
          server: 'graph',
          tool: 'search',
          arguments_bytes: 2,
          arguments_sha256: 'a',
          content_kept: true,
        },
      },
      {
        type: 'tool_test_answered',
        data: {
          test_id: testId,
          is_error: false,
          result_bytes: 61,
          result_sha256: 'b',
          content_kept: true,
          duration_ms: 3,
          jsonrpc_id: 2,
        },
      },
      { type: 'tool_test_failed', data: { test_id: testId, because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 3 } },
    ]);
  });

  it('takes a start, and then an answer or a failure', () => {
    expect(toolTestDecider.decide({ event: started, context }, after())).toEqual(Result.succeed([started]));
    expect(toolTestDecider.decide({ event: answered, context }, after(started))).toEqual(Result.succeed([answered]));
    expect(toolTestDecider.decide({ event: failed, context }, after(started))).toEqual(Result.succeed([failed]));
    expect(toolTestDecider.context({ event: failed, context }, after(started))).toEqual(context);
  });

  it('refuses an end before the start, a second start and a second end', () => {
    expect(toolTestDecider.decide({ event: answered, context }, after())).toMatchObject(outOfTurn);
    expect(toolTestDecider.decide({ event: started, context }, after(started))).toMatchObject(outOfTurn);
    expect(toolTestDecider.decide({ event: failed, context }, after(started, answered))).toMatchObject(outOfTurn);
  });
});
