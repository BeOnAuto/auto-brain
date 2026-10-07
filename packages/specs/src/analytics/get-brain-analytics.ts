import { BrainReader, defineQuery } from '@beonauto/operations';
import { Clock, Effect, Schema } from 'effect';

import { RunsOfNameField } from '../operations/spec-fields.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import { PrimitiveField, knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { analyticsOf, BrainAnalyticsSchema } from './analytics-answer.ts';
import { DaysField, dayFieldOf, dayOf, longestWindowInDays, windowOf } from './analytics-window.ts';
import { analyticsWords } from './analytics-words.ts';

const description = [
  'Counts what the runs of the brain did over a window of days in UTC: how many succeeded, failed or were rejected,',
  'the tokens their models used, and how long they took at the median and the 95th percentile,',
  'for the window, for each day of it and for each definition.',
  'Use it when the person asks how the brain is doing; list_executions lists the runs themselves.',
  '`days` reads the last 7, 14 or 30 days, or `from` and `to` the days between them, and `primitive` and `name` keep the runs of one definition.',
].join(' ');

const AnalyticsInputSchema = Schema.Struct({
  days: Schema.optionalKey(DaysField),
  from: Schema.optionalKey(dayFieldOf('The first day to read, YYYY-MM-DD in UTC, given with to and not with days')),
  to: Schema.optionalKey(
    dayFieldOf(
      `The last day to read, YYYY-MM-DD in UTC, no later than today and at most ${longestWindowInDays} days from the first`,
    ),
  ),
  primitive: Schema.optionalKey(PrimitiveField),
  name: Schema.optionalKey(RunsOfNameField),
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
  return known.publish(operation, 'Only the runs of definitions of this type');
}
