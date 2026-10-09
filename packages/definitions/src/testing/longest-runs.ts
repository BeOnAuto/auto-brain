import { Effect } from 'effect';

import type { RunContext } from '../index.ts';

export const noLongestRuns: RunContext['longestRunOf'] = () => Effect.undefined;
