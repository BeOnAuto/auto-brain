export const campaignReviews = [
  '---',
  'description: The reviews of each campaign, latest last, as the review-brief function wrote them',
  'language: typescript',
  'source:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: reasoning/review-brief',
  'view:',
  '  initial: {}',
  '  schema:',
  '    type: object',
  '    maxProperties: 50',
  '    additionalProperties:',
  '      type: array',
  '      maxItems: 20',
  '      items: { type: object, required: [at, verdict, run], properties: { at: { type: string }, verdict: { type: string }, run: { type: string } } }',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [campaign]',
  '    properties:',
  '      campaign: { type: string }',
  '      last: { type: integer, minimum: 1, maximum: 50 }',
  'output:',
  '  schema:',
  '    type: array',
  '    items: { type: object, required: [at, verdict], properties: { at: { type: string }, verdict: { type: string }, run: { type: string } } }',
  '---',
  'type Review = View[string][number];',
  '',
  'function fieldOf(value: Json | undefined, name: string): Json | undefined {',
  "  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;",
  '}',
  '',
  'function lastAt(reviews: Review[]): string {',
  "  return reviews.at(-1)?.at ?? '';",
  '}',
  '',
  'export function fold(view: View, event: Event): View {',
  "  const output = fieldOf(event.data, 'output');",
  "  const named = fieldOf(output, 'campaign');",
  "  const campaign = typeof named === 'string' ? named : 'unknown';",
  "  const given = fieldOf(output, 'verdict') ?? 'none';",
  "  const verdict = (typeof given === 'string' ? given : JSON.stringify(given)).slice(0, 200);",
  "  const reviews = [...(view[campaign] ?? []), { at: event.time ?? '', verdict, run: event.source }].slice(-20);",
  '  const latest = Object.entries({ ...view, [campaign]: reviews })',
  '    .toSorted(([, first], [, second]) => (lastAt(first) < lastAt(second) ? -1 : lastAt(first) > lastAt(second) ? 1 : 0))',
  '    .slice(-50);',
  '  return Object.fromEntries(latest);',
  '}',
  '',
  'export function answer(view: View, input: Input): Output {',
  '  return (view[input.campaign] ?? []).slice(-(input.last ?? 5));',
  '}',
].join('\n');

export const reviewBrief = [
  '---',
  'description: Reviews a campaign brief against the criteria',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {brief: {type: string}}, required: [brief]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {campaign: {type: string}, verdict: {type: string}}, required: [campaign, verdict]}',
  '---',
  'Review this campaign brief and give the campaign and your verdict: {{ input.brief }}',
].join('\n');

export function recallDocument(
  module: string,
  frontMatter = 'language: typescript\nsource:\n  events:\n    - type: run_succeeded',
): string {
  return `---\n${frontMatter}\n---\n${module}`;
}

export function foldOf(body: string, answerBody?: string): string {
  const fold = `export function fold(view: any, event: any): unknown {\n  ${body}\n}`;
  return answerBody === undefined
    ? fold
    : `${fold}\n\nexport function answer(view: any, input: any): unknown {\n  ${answerBody}\n}`;
}
