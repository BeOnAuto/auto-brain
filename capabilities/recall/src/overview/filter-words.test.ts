import { describe, expect, it } from 'vitest';

import { foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { recallWith } from '../testing/recall-runs.ts';

function rememberedOf(...filters: readonly string[]): readonly string[] {
  const source = recallDocument(
    foldOf('return view;'),
    ['language: typescript', 'source:', '  events:', ...filters.map((filter) => `    - ${filter}`)].join('\n'),
  );
  const overview = recallWith().prepared(source).overview('remembered');
  const section = overview.split('## What it remembers\n\n')[1]?.split('\n\n## ')[0] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

describe('the events a recall function remembers, in its overview', () => {
  it('say each event type of the playbook in words, with the definition its subject or source names', () => {
    expect(
      rememberedOf(
        '{ type: run_started, subject: workflow/greet }',
        '{ type: run_succeeded, subject: reasoning/review-brief }',
        '{ type: run_failed }',
        '{ type: run_rejected, subject: computation/campaign-pace }',
        '{ type: definition_created, source: /definitions/recall/campaign-reviews }',
        '{ type: definition_updated }',
        '{ type: definition_retired, source: /definitions/workflow/greet }',
        '{ type: campaign_launched }',
      ),
    ).toEqual([
      'each time a run of the workflow **greet** starts',
      'each time a run of the reasoning function **review-brief** succeeds',
      'each time a run of any function or workflow fails',
      'each time a run of the computation function **campaign-pace** is rejected',
      'each time the recall function **campaign-reviews** is created',
      'each time any function or workflow is updated',
      'each time the workflow **greet** is retired',
      'each time an event `campaign_launched` is published to the playbook',
    ]);
  });

  it('say each other attribute a filter names, its source, subject, caller and data among them', () => {
    expect(
      rememberedOf(
        '{ type: run_succeeded, subject: oddly }',
        '{ type: definition_created, source: /runs/0199a3c4 }',
        "{ type: run_succeeded, subject: prediction/weekly-orders, caller: 'acme-admin' }",
        "{ type: run_started, caller: 'playbook:finance', triggerkind: event }",
        '{ type: campaign_launched, source: crm, subject: eu, data: { region: eu } }',
        "{ type: order_placed, data: '${ $data.revenue > 100 }' }",
        '{ type: run_succeeded, depth: 2, definitionversion: 3 }',
        '{ type: definition_updated, source: /definitions/review-brief/ }',
      ),
    ).toEqual([
      'each time a run succeeds, with the subject `oddly`',
      'each time a definition is created, from the source `/runs/0199a3c4`',
      'each time a run of the prediction function **weekly-orders** succeeds, when the caller is `acme-admin`',
      'each time a run of any function or workflow starts, when the caller is the playbook `finance`, as for a run a trigger started and the runs it calls and when its `triggerkind` is `event`',
      'each time an event `campaign_launched` is published to the playbook, from the source `crm` and with the subject `eu` and when its data is exactly `{"region":"eu"}`',
      'each time an event `order_placed` is published to the playbook, when `$data.revenue > 100` holds for its data',
      'each time a run of any function or workflow succeeds, when its `depth` is `2` and when its `definitionversion` is `3`',
      'each time a definition is updated, from the source `/definitions/review-brief/`',
    ]);
  });
});
