import { mostFilterMs, mostInputMs, testedOrRaised } from '../dsl/evaluation.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import { caughtRaiseLater } from '../dsl/raised-error.ts';
import type { Evaluation, ProgramFailure, ProgramRun } from '../programs/program-run.ts';
import { meterOf, type Meter } from '../runner/run-tables.ts';
import { attributeHoldsLater, filterAttributesOf, type FilterAttribute } from './attribute-match.ts';
import type { FilterVerdict, LiteralFilter } from './event-filter.ts';

type AskedTest = (value: string, evaluation: Evaluation) => Promise<ProgramRun>;

export interface FilterSession {
  readonly define: (source: string) => AskedTest;
  readonly freeze: () => Promise<ProgramFailure | undefined>;
  readonly close: () => void;
}

export interface FilterSandbox {
  readonly session: (opening: () => Evaluation) => Promise<FilterSession>;
  readonly clock: () => number;
}

export type MatchedFilter = Pick<LiteralFilter, 'reference' | 'attributes'>;

interface PreparedFilter {
  readonly reference: string;
  readonly attributes: readonly FilterAttribute<AskedTest>[];
}

interface Testing {
  readonly meter: Meter;
  readonly reference: string;
  readonly deadlineAt: number;
  readonly now: number;
  readonly refused: () => void;
}

function preparedOf({ reference, attributes }: MatchedFilter, define: FilterSession['define']): PreparedFilter {
  return { reference, attributes: filterAttributesOf(attributes, define) };
}

function verdictIn(testing: Testing): (test: AskedTest, actual: Json, source: string) => Promise<Json> {
  return async (test, actual, source) => {
    const run = await test(JSON.stringify(actual), {
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

async function attributesHold(
  attributes: readonly FilterAttribute<AskedTest>[],
  event: JsonObject,
  testing: Testing,
): Promise<boolean> {
  const [attribute, ...rest] = attributes;
  if (attribute === undefined) {
    return true;
  }
  return (await attributeHoldsLater(attribute, event, verdictIn(testing))) && attributesHold(rest, event, testing);
}

async function verdictsUntilRefused(
  filters: readonly PreparedFilter[],
  event: JsonObject,
  sandbox: FilterSandbox,
  now: number,
): Promise<readonly FilterVerdict[]> {
  const [filter, ...rest] = filters;
  if (filter === undefined) {
    return [];
  }
  const state = { refused: false };
  const testing: Testing = {
    meter: meterOf(),
    reference: filter.reference,
    deadlineAt: sandbox.clock() + mostFilterMs,
    now,
    refused: () => {
      state.refused = true;
    },
  };
  const verdict = await caughtRaiseLater<FilterVerdict>(
    () => attributesHold(filter.attributes, event, testing),
    (error) => ({ error, stopped: state.refused }),
  );
  return state.refused ? [verdict] : [verdict, ...(await verdictsUntilRefused(rest, event, sandbox, now))];
}

async function verdictsInSession(
  session: FilterSession,
  filters: readonly MatchedFilter[],
  event: JsonObject,
  { sandbox, now }: { readonly sandbox: FilterSandbox; readonly now: number },
): Promise<readonly FilterVerdict[]> {
  try {
    const prepared = filters.map((filter) => preparedOf(filter, session.define));
    await session.freeze();
    return await verdictsUntilRefused(prepared, event, sandbox, now);
  } finally {
    session.close();
  }
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
  const session = await sandbox.session(() => ({
    budget: Number.POSITIVE_INFINITY,
    deadlineAt: sandbox.clock() + mostInputMs,
    moment: now,
  }));
  const verdicts = await verdictsInSession(session, filters, event, { sandbox, now });
  return [...verdicts, ...(await filterVerdictsOf(filters.slice(verdicts.length), event, sandbox, now))];
}
