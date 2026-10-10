import { mostInputMs, testedOrRaised } from '../dsl/evaluation.ts';
import type { JsonObject } from '../dsl/json.ts';
import { caughtRaise } from '../dsl/raised-error.ts';
import type { FilterContext, FilterTest } from '../programs/kept-contexts.ts';
import type { Evaluation } from '../programs/program-run.ts';
import { meterOf, type Meter } from '../runner/run-tables.ts';
import { attributeHolds, filterAttributesOf, type FilterAttribute, type Verdict } from './attribute-match.ts';
import type { FilterVerdict, LiteralFilter } from './event-filter.ts';

export interface FilterSandbox {
  readonly context: (opening: () => Evaluation) => Promise<FilterContext>;
  readonly clock: () => number;
}

export type MatchedFilter = Pick<LiteralFilter, 'reference' | 'attributes'>;

interface PreparedFilter {
  readonly reference: string;
  readonly attributes: readonly FilterAttribute<FilterTest>[];
}

interface Testing {
  readonly meter: Meter;
  readonly reference: string;
  readonly deadlineAt: number;
  readonly now: number;
  readonly refused: () => void;
}

function preparedOf({ reference, attributes }: MatchedFilter, define: FilterContext['define']): PreparedFilter {
  return { reference, attributes: filterAttributesOf(attributes, define) };
}

function verdictIn(testing: Testing): Verdict<FilterTest> {
  return (test, actual, source) => {
    const run = test(JSON.stringify(actual), {
      budget: testing.meter.allowance(),
      deadlineAt: testing.deadlineAt,
      moment: testing.now,
    });
    if (run.ran === 'exhausted') {
      testing.refused();
    }
    return testedOrRaised(source, run, testing);
  };
}

function filterVerdict(filter: PreparedFilter, event: JsonObject, testing: Testing): FilterVerdict {
  return caughtRaise<FilterVerdict>(
    () => filter.attributes.every((attribute) => attributeHolds(attribute, event, verdictIn(testing))),
    (error) => ({ error }),
  );
}

function verdictsUntilRefused(
  filters: readonly PreparedFilter[],
  event: JsonObject,
  sandbox: FilterSandbox,
  now: number,
): readonly FilterVerdict[] {
  const verdicts: FilterVerdict[] = [];
  const state = { refused: false };
  const refused = (): void => {
    state.refused = true;
  };
  for (const filter of filters) {
    const testing = { meter: meterOf(), reference: filter.reference, deadlineAt: sandbox.clock() + mostInputMs, now };
    verdicts.push(filterVerdict(filter, event, { ...testing, refused }));
    if (state.refused) {
      break;
    }
  }
  return verdicts;
}

export async function filterVerdictsOf(
  filters: readonly MatchedFilter[],
  event: JsonObject,
  sandbox: FilterSandbox,
  now: number,
): Promise<readonly FilterVerdict[]> {
  if (filters.length === 0) {
    return [];
  }
  const context = await sandbox.context(() => ({
    budget: Number.POSITIVE_INFINITY,
    deadlineAt: sandbox.clock() + mostInputMs,
    moment: now,
  }));
  const verdicts = ((): readonly FilterVerdict[] => {
    try {
      const prepared = filters.map((filter) => preparedOf(filter, context.define));
      context.freeze();
      return verdictsUntilRefused(prepared, event, sandbox, now);
    } finally {
      context.close();
    }
  })();
  return [...verdicts, ...(await filterVerdictsOf(filters.slice(verdicts.length), event, sandbox, now))];
}
