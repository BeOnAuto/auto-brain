import { detailsOf } from './view-documents.ts';

export const reviewsFold = [
  'type Review = { at: string; verdict: string; run: string };',
  'type Reviews = { [campaign: string]: Review[] };',
  '',
  'function fieldOf(value: unknown, name: string): unknown {',
  "  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Reflect.get(value, name) : undefined;",
  '}',
  '',
  'function lastAt(reviews: Review[]): string {',
  "  return reviews.at(-1)?.at ?? '';",
  '}',
  '',
  'export function fold(view: Reviews, event: { time?: string; source: string; data: unknown }): Reviews {',
  "  const output = fieldOf(event.data, 'output');",
  "  const named = fieldOf(output, 'campaign');",
  "  const campaign = typeof named === 'string' ? named : 'unknown';",
  "  const verdict = String(fieldOf(output, 'verdict') ?? 'none').slice(0, 200);",
  "  const reviews = [...(view[campaign] ?? []), { at: event.time ?? '', verdict, run: event.source }].slice(-20);",
  '  const latest = Object.entries({ ...view, [campaign]: reviews })',
  '    .toSorted(([, first], [, second]) => (lastAt(first) < lastAt(second) ? -1 : lastAt(first) > lastAt(second) ? 1 : 0))',
  '    .slice(-50);',
  '  return Object.fromEntries(latest);',
  '}',
  '',
  'export function answer(view: Reviews, input: { campaign: string; last?: number }): Review[] {',
  '  return (view[input.campaign] ?? []).slice(-(input.last ?? 5));',
  '}',
].join('\n');

const reviewFilters = [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }];

const reviewsSchema = {
  type: 'object',
  maxProperties: 50,
  additionalProperties: { type: 'array', maxItems: 20 },
};

export const campaignReviews = detailsOf(reviewsFold, reviewFilters, { schema: reviewsSchema });
