export const campaignReviews = [
  '---',
  'description: The reviews of each campaign, latest last, as the review-brief function wrote them',
  'language: jq',
  'source:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: reasoning/review-brief',
  'view:',
  '  initial: {}',
  '  schema:',
  '    type: object',
  '    maxProperties: 50',
  '    additionalProperties: { type: array, maxItems: 20 }',
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
  '    items: { type: object, required: [at, verdict], properties: { at: { type: string }, verdict: { type: string } } }',
  "answer: '.[$input.campaign] // [] | .[-($input.last // 5):]'",
  '---',
  '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
  '| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]',
  '| .[$campaign] |= .[-20:]',
  '| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries',
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
  fold: string,
  frontMatter = 'language: jq\nsource:\n  events:\n    - type: run_succeeded',
): string {
  return `---\n${frontMatter}\n---\n${fold}`;
}
