import { filterVerdictsOf, type FilterVerdict, type JsonObject, type LiteralFilter } from '@beonauto/workflow-engine';
import { filterInstances, hostClock, type SandboxInstance } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

export type MatchedFilter = Pick<LiteralFilter, 'reference' | 'attributes'>;

export type MatchFilters = (
  filters: readonly MatchedFilter[],
  event: JsonObject,
  now: number,
) => Effect.Effect<readonly FilterVerdict[]>;

export function filterMatchingOf(
  instances: () => Promise<SandboxInstance> = filterInstances(),
  clock: () => number = hostClock,
): MatchFilters {
  return (filters, event, now) =>
    filters.length === 0
      ? Effect.succeed([])
      : Effect.map(Effect.promise(instances), (instance) => filterVerdictsOf(filters, event, { instance, clock, now }));
}

export function groupVerdicts(
  match: MatchFilters,
  groups: readonly (readonly MatchedFilter[])[],
  event: JsonObject,
  now: number,
): Effect.Effect<readonly (readonly FilterVerdict[])[]> {
  return Effect.map(match(groups.flat(), event, now), (verdicts) => {
    const rest = [...verdicts];
    return groups.map((filters) => rest.splice(0, filters.length));
  });
}
