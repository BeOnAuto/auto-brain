import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { callMarginMs, longestCallsOf } from './call-limits.ts';

const longestRuns: Readonly<Record<string, number>> = {
  'reasoning/classify': 85_000,
  'workflow/review': 3_600_000,
};

function longestRunOf(type: string, name: string): Effect.Effect<number | undefined> {
  return Effect.succeed(longestRuns[`${type}/${name}`]);
}

const document = workflow(`
do:
  - classify: { call: run_definition, with: { type: reasoning, name: classify } }
  - each:
      for: { in: '\${ $data.items }' }
      do:
        - review: { call: run_definition, with: { type: workflow, name: review } }
  - computed: { call: run_definition, with: { type: reasoning, name: '\${ $data.name }' } }
  - unsaved: { call: run_definition, with: { type: reasoning, name: summarize } }
  - plain: { call: run_definition, with: reasoning }
  - other: { call: notify, with: { type: reasoning, name: classify } }
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
