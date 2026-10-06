import { BrainReader, defineQuery } from '@beonauto/operations';
import { Clock, Effect, Schema } from 'effect';

import { SpecNameField } from '../operations/spec-fields.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import { PrimitiveField, knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { analyticsOf, BrainAnalyticsSchema } from './analytics-answer.ts';
import { DayField, DaysField, dayOf, defaultDays, longestWindowInDays, windowOf } from './analytics-window.ts';
import { analyticsWords } from './analytics-words.ts';

const description = [
  'Reads what the runs of the brain did over a window of days in UTC, counted by the day each run first started:',
  'how many ended, by how they ended (succeeded, failed or rejected), the tokens their models used,',
  'and how long they took, at the median and the 95th percentile, for the whole window, for each day of it,',
  'and for each definition by API type identifier and name.',
  `\`days\`, 7, 14 or 30, reads the last days ending today, ${defaultDays} when left out;`,
  `\`from\` and \`to\`, days as YYYY-MM-DD, read the days between them, both included, at most ${longestWindowInDays},`,
  'to no later than today. `days` and `from` and `to` are not given together.',
  '`primitive` and `name` keep the runs of that API type identifier and definition name.',
  'A run still going counts nowhere. Durations run from the latest start of a run to its end,',
  'for the runs that succeeded or failed; a rejected run counts in runs and in tokens when it recorded them,',
  'never in durations. A percentile is the nearest rank over those durations, and null when there are none.',
  'Tokens sum what the runs recorded, over every attempt of a run started again under its id, 0 when none did;',
  '`cached` is the part of `input` read from a cache.',
  '`by_day` holds every day of the window, oldest first, and `by_function` the definitions with the most runs first.',
  'Rejected with invalid_input for a window it cannot read, such as a day that is not in the calendar.',
].join(' ');

const AnalyticsInputSchema = Schema.Struct({
  days: Schema.optionalKey(DaysField),
  from: Schema.optionalKey(DayField.annotate({ description: 'The first day to read, as YYYY-MM-DD, in UTC' })),
  to: Schema.optionalKey(DayField.annotate({ description: 'The last day to read, as YYYY-MM-DD, in UTC' })),
  primitive: Schema.optionalKey(PrimitiveField),
  name: Schema.optionalKey(SpecNameField.annotate({ description: 'Only runs of definitions with this name' })),
});

type AnalyticsInput = typeof AnalyticsInputSchema.Type;

function selectionOf({ primitive, name }: AnalyticsInput) {
  return { ...(primitive === undefined ? {} : { primitive }), ...(name === undefined ? {} : { name }) };
}

const readAnalytics = Effect.fnUntraced(function* (input: AnalyticsInput) {
  const window = yield* windowOf(input, dayOf(yield* Clock.currentTimeMillis));
  const groups = yield* (yield* BrainReader).readRunOutcomes({ from: window.from, to: window.to }, selectionOf(input));
  return analyticsOf(window, groups);
});

export function defineGetBrainAnalytics(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const operation = defineQuery('brain', {
    name: 'get_brain_analytics',
    title: 'Get brain analytics',
    description,
    route: { method: 'GET', path: '/analytics' },
    inputSchema: AnalyticsInputSchema,
    outputSchema: BrainAnalyticsSchema,
    reasons: ['invalid_input'],
    handle: readAnalytics,
    plainLanguage: analyticsWords(specWordsFor(primitives)),
  });
  return known.publish(operation, 'Only runs of definitions with this API type identifier');
}
