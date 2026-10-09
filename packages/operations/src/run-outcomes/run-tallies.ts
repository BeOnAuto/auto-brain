import { Effect, Option, Result, Schema } from 'effect';

import {
  BrainReader,
  defineQuery,
  type Decider,
  type RunOutcome,
  type RunOutcomeGroup,
  type RunOutcomeMapping,
} from '../index.ts';

const BeganSchema = Schema.Struct({ type: Schema.Literal('run_began'), at: Schema.String, fn: Schema.String });

const EndedSchema = Schema.Struct({
  type: Schema.Literal('run_ended'),
  status: Schema.Literals(['succeeded', 'failed', 'rejected']),
  ms: Schema.NullOr(Schema.Int),
  tokens: Schema.NullOr(Schema.Int),
  note: Schema.optionalKey(Schema.String),
});

const RunFactSchema = Schema.Union([BeganSchema, EndedSchema, Schema.Struct({ type: Schema.Literal('run_noted') })]);

export type RunFact = typeof RunFactSchema.Type;

export const runFacts: Decider<null, readonly RunFact[], RunFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  eventSchema: RunFactSchema,
};

const TalliedSchema = Schema.Union([BeganSchema, EndedSchema]);

const decodeFact = Schema.decodeUnknownOption(TalliedSchema);

function tallied(row: RunOutcome | undefined, fact: typeof TalliedSchema.Type): RunOutcome | undefined {
  if (fact.type === 'run_began') {
    const { at, fn } = fact;
    const started = {
      startedDay: at.slice(0, 10),
      startedAt: at,
      lastStartedAt: at,
      definitionType: 'tally',
      name: fn,
    };
    return {
      ...started,
      status: 'started',
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
    };
  }
  if (row === undefined) {
    return undefined;
  }
  const { status, ms, tokens } = fact;
  return { ...row, status, durationMs: ms, inputTokens: tokens, outputTokens: tokens, cachedTokens: tokens };
}

export const runTallies: RunOutcomeMapping = {
  types: ['run_began', 'run_ended'],
  rowAfter: (row, event) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(event), (fact) => tallied(row, fact))),
};

const GroupSchema = Schema.Struct({
  day: Schema.String,
  type: Schema.String,
  name: Schema.String,
  status: Schema.String,
  runs: Schema.Int,
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  cachedTokens: Schema.Int,
  durations: Schema.Array(Schema.Int),
});

function talliedGroupOf(group: RunOutcomeGroup): typeof GroupSchema.Type {
  return {
    day: group.day,
    type: group.definitionType,
    name: group.name,
    status: group.status,
    runs: group.runs,
    inputTokens: group.inputTokens,
    outputTokens: group.outputTokens,
    cachedTokens: group.cachedTokens,
    durations: group.durations,
  };
}

export const readRunTallies = defineQuery('brain', {
  name: 'read_run_tallies',
  title: 'Read run tallies',
  description: 'Reads the outcomes of the runs of the brain between two days, taking any days it is given.',
  route: { method: 'GET', path: '/run-tallies' },
  inputSchema: Schema.Struct({ from: Schema.String, to: Schema.String, name: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ groups: Schema.Array(GroupSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ from, to, name }) {
    const selection = name === undefined ? {} : { name };
    const groups = yield* (yield* BrainReader).readRunOutcomes({ from, to }, selection);
    return { groups: groups.map((group) => talliedGroupOf(group)) };
  }),
});
