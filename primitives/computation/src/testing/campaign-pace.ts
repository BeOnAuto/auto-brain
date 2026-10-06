import type { Schema } from 'effect';

export const campaignPace = [
  '---',
  'description: Spend, pace and projection per campaign, in cents, for a reporting period',
  'language: jq',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [rows, period]',
  '    properties:',
  '      rows: { type: array, items: { type: object, required: [campaign, cost_cents, budget_cents], properties: { campaign: { type: string }, cost_cents: { type: integer }, budget_cents: { type: integer } } } }',
  '      period: { type: object, required: [days_elapsed, days_total], properties: { days_elapsed: { type: integer, minimum: 1 }, days_total: { type: integer, minimum: 1 } } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [campaigns, total_spend_cents]',
  '    properties:',
  '      campaigns: { type: array, items: { type: object } }',
  '      total_spend_cents: { type: integer }',
  '---',
  '.period as $p',
  '| .rows',
  '| group_by(.campaign)',
  '| map({ campaign: .[0].campaign,',
  '        spend_cents: (map(.cost_cents) | add),',
  '        budget_cents: .[0].budget_cents,',
  '        projected_cents: ((map(.cost_cents) | add) * $p.days_total / $p.days_elapsed | floor) })',
  '| map(. + { pace_permille: (if .budget_cents == 0 then null else (.projected_cents * 1000 / .budget_cents | floor) end) })',
  '| { campaigns: ., total_spend_cents: (map(.spend_cents) | add) }',
].join('\n');

const campaigns = 4;

export function campaignRows(count: number): Schema.JsonObject {
  return {
    rows: Array.from({ length: count }, (_, index) => ({
      campaign: `campaign-${index % campaigns}`,
      cost_cents: 1000 + ((index * 37) % 9000),
      budget_cents: 5_000_000,
    })),
    period: { days_elapsed: 12, days_total: 31 },
  };
}
