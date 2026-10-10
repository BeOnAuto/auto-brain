import {
  filterVerdictsOf,
  type FilterSandbox,
  type FilterVerdict,
  type JsonObject,
  type MatchedFilter,
} from '@beonauto/workflow-engine';
import { filterSandboxOf } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

export type MatchFilters = (
  filters: readonly MatchedFilter[],
  event: JsonObject,
  now: number,
) => Effect.Effect<readonly FilterVerdict[]>;

export function filterMatchingOf(sandbox: FilterSandbox = filterSandboxOf()): MatchFilters {
  return (filters, event, now) => Effect.promise(() => filterVerdictsOf(filters, event, sandbox, now));
}

export function groupVerdicts(
  match: MatchFilters,
  groups: readonly (readonly MatchedFilter[])[],
  event: JsonObject,
  now: number,
): Effect.Effect<readonly (readonly FilterVerdict[])[]> {
  return Effect.forEach(groups, (filters) => match(filters, event, now));
}
