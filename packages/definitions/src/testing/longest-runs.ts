import { Effect } from 'effect';

import type { RunContext } from '../index.ts';

function noLongestRun(): Effect.Effect<undefined> {
  return Effect.undefined;
}

export const noLongestRuns: Pick<RunContext, 'longestRunOf' | 'longestRunFor'> = {
  longestRunOf: noLongestRun,
  longestRunFor: noLongestRun,
};
