import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { callMarginMs, longestCallsOf } from './call-limits.ts';

const longestRuns: Readonly<Record<string, number>> = {
  'inference/classify': 85_000,
  'orchestration/review': 3_600_000,
};

function longestRunOf(primitive: string, name: string): Effect.Effect<number | undefined> {
  return Effect.succeed(longestRuns[`${primitive}/${name}`]);
}

const document = workflow(`
do:
  - classify: { call: execute_spec, with: { primitive: inference, name: classify } }
  - each:
      for: { in: '\${ .items }' }
      do:
        - review: { call: execute_spec, with: { primitive: orchestration, name: review } }
  - computed: { call: execute_spec, with: { primitive: inference, name: '\${ .name }' } }
  - unsaved: { call: execute_spec, with: { primitive: inference, name: summarize } }
  - plain: { call: execute_spec, with: inference }
  - other: { call: notify, with: { primitive: inference, name: classify } }
  - pause: { wait: PT1M }
`);

describe('the longest call of each step of a workflow', () => {
  it('is the longest run of the definition it names, written out, with a minute of grace, wherever the step sits', async () => {
    expect(await Effect.runPromise(longestCallsOf(document, longestRunOf))).toEqual({
      '/do/0/classify': 85_000 + callMarginMs,
      '/do/1/each/do/0/review': 3_600_000 + callMarginMs,
    });
  });

  it('is left to the run-wide value for a definition computed at run time, one not saved, or another function', async () => {
    const limits = await Effect.runPromise(longestCallsOf(document, longestRunOf));

    expect(Object.keys(limits)).not.toContain('/do/2/computed');
    expect(Object.keys(limits)).not.toContain('/do/3/unsaved');
  });
});
