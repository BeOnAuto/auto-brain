import {
  filterVerdictsOf,
  type DslError,
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

interface FilterGroup {
  readonly scope: string;
  readonly filters: readonly MatchedFilter[];
}

interface GroupMatched {
  readonly verdicts: readonly FilterVerdict[];
  readonly stopped: readonly DslError[];
}

export type MatchGroups = (
  groups: readonly FilterGroup[],
  event: JsonObject,
  now: number,
) => Effect.Effect<readonly GroupMatched[]>;

interface PlacedFilter {
  readonly filter: MatchedFilter;
  readonly place: string;
}

interface StoppedFilter {
  readonly place: string;
  readonly error: DslError;
}

export function filterMatchingOf(sandbox: FilterSandbox = filterSandboxOf()): MatchFilters {
  return (filters, event, now) => Effect.promise(() => filterVerdictsOf(filters, event, sandbox, now));
}

function stoppedAmong(placed: readonly PlacedFilter[], verdicts: readonly FilterVerdict[]): readonly StoppedFilter[] {
  return placed.flatMap(({ place }, index) => {
    const verdict = verdicts[index];
    return typeof verdict === 'object' && verdict.stopped ? [{ place, error: verdict.error }] : [];
  });
}

export function groupMatchingOf(match: MatchFilters): MatchGroups {
  const stopped = new Set<string>();
  const matchedGroup = ({ scope, filters }: FilterGroup, event: JsonObject, now: number) => {
    const placed = filters
      .map((filter, index): PlacedFilter => ({ filter, place: JSON.stringify([scope, index]) }))
      .filter(({ place }) => !stopped.has(place));
    const verdicts = match(
      placed.map(({ filter }) => filter),
      event,
      now,
    );
    return Effect.map(verdicts, (answered): GroupMatched => {
      const newlyStopped = stoppedAmong(placed, answered);
      for (const { place } of newlyStopped) {
        stopped.add(place);
      }
      return { verdicts: answered, stopped: newlyStopped.map(({ error }) => error) };
    });
  };
  return (groups, event, now) => Effect.forEach(groups, (group) => matchedGroup(group, event, now));
}
