import { enclosedBody, filterVerdictsOf, type FilterSandbox, type FilterVerdict } from '@on.auto/workflow-engine';
import type { PageEvent } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';

import { canonicalJson } from '../data/data-digest.ts';
import type { DatasetData } from './dataset-data.ts';

export type EventMatch =
  | { readonly kind: 'taken' }
  | { readonly kind: 'not_taken' }
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'stopped'; readonly detail: string };

type Filter = DatasetData['events'][number];

const taken: EventMatch = { kind: 'taken' };

const notTaken: EventMatch = { kind: 'not_taken' };

function isTested(filter: Filter): boolean {
  return Object.values(filter).some((expected) => enclosedBody(expected) !== undefined);
}

function holdsLiterally(filter: Filter, event: Schema.JsonObject): boolean {
  return Object.entries(filter).every(
    ([name, expected]: readonly [string, Schema.Json]) =>
      canonicalJson(expected) === canonicalJson(event[name] ?? null),
  );
}

function wordsOf({ error }: Extract<FilterVerdict, object>): string {
  return [error.title, error.detail].filter((part) => part !== undefined).join(': ');
}

function matchOfVerdicts(verdicts: readonly FilterVerdict[]): EventMatch {
  if (verdicts.includes(true)) {
    return taken;
  }
  const failures = verdicts.flatMap((verdict) => (typeof verdict === 'object' ? [verdict] : []));
  const [failed] = failures;
  if (failed === undefined) {
    return notTaken;
  }
  const stop = failures.find((failure) => failure.stopped);
  return stop === undefined
    ? { kind: 'refused', detail: `Its data test failed: ${wordsOf(failed)}` }
    : { kind: 'stopped', detail: wordsOf(stop) };
}

export function eventMatchOf(
  data: DatasetData,
  { event, recordedAt }: PageEvent,
  sandbox: FilterSandbox,
): Effect.Effect<EventMatch> {
  const typed = data.events.filter(({ type }) => type === event.type);
  if (typed.some((filter) => !isTested(filter) && holdsLiterally(filter, event))) {
    return Effect.succeed(taken);
  }
  const tested = typed.filter((filter) => isTested(filter));
  if (tested.length === 0) {
    return Effect.succeed(notTaken);
  }
  const filters = tested.map((attributes, index) => ({ reference: `/data/events/${index}`, attributes }));
  return Effect.map(
    Effect.promise(() => filterVerdictsOf(filters, event, sandbox, Date.parse(recordedAt))),
    matchOfVerdicts,
  );
}
