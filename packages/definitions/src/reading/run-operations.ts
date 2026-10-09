import type { Presenter } from '@beonauto/operations';

import { defineGetBrainAnalytics } from '../analytics/get-brain-analytics.ts';
import { defineCancelRun } from '../cancellation/cancel-run.ts';
import type { Capability } from '../capability/capability.ts';
import { defineGetRun } from '../operations/get-run.ts';
import { makeDefinitionPresenters } from '../presenting/definition-presenters.ts';
import { defineGetRunHistory } from './get-run-history.ts';
import { defineListRuns } from './list-runs.ts';

export function runOperations(
  capabilities: readonly Capability[],
  presenters: readonly Presenter[] = makeDefinitionPresenters(capabilities),
) {
  return [
    defineGetRun(capabilities),
    defineCancelRun(capabilities),
    defineListRuns(capabilities),
    defineGetRunHistory(presenters),
    defineGetBrainAnalytics(capabilities),
  ];
}
