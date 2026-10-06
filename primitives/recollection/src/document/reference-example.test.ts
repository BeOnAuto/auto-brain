import { readFileSync } from 'node:fs';

import { Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { recallFolding } from '../run/recall-bounds.ts';
import { campaignReviews } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith, workerTestTimeoutMs } from '../testing/recall-runs.ts';
import { parseRecallDocument } from './document-parsing.ts';

const referencePage = readFileSync(new URL('../../../../docs/reference/recall-format.md', import.meta.url), 'utf8');

const fencedBlocks = [...referencePage.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const reviews = [
  ['2026-09-30T14:02:11.000Z', '71', { campaign: 'autumn-launch', verdict: 'approve' }],
  ['2026-10-01T09:15:42.000Z', '72', { campaign: 'spring-sale', verdict: 'reject: the budget is not stated' }],
  ['2026-10-03T16:40:05.000Z', '73', { campaign: 'spring-sale', verdict: 'approve' }],
] as const;

const events = reviews.map(([time, run, output]) => ({
  specversion: '1.0',
  id: `5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f${run}`,
  source: `/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b${run}`,
  type: 'execution_succeeded',
  subject: 'inference/review-brief',
  time,
  data: { primitive: 'inference', name: 'review-brief', version: 1, caller: 'acme-admin', output },
}));

describe('the example on the reference page of recall functions', { timeout: workerTestTimeoutMs }, () => {
  it('is, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${campaignReviews}\n`);
  });

  it('folds the three runs of review-brief to the view the page shows', async () => {
    const [, view] = fencedBlocks;
    const { fold, filters, initial, schema = {} } = Result.getOrThrow(parseRecallDocument(campaignReviews)).details;

    const folded = await poolOf().fold({
      ...recallFolding,
      events,
      views: [{ fold, filters, view: initial, schema, events: [0, 1, 2] }],
      waitMs: 5000,
      deadlineMs: 20_000,
    });

    expect(view?.language).toBe('json');
    expect(folded).toMatchObject({ ran: 'folded', views: [{ folded: 3, view: decodeJson(view?.body) }] });
  });

  it('answers the input the page gives with the output the page shows', async () => {
    const [, view, input, output] = fencedBlocks;
    const run = recallWith();
    run.keep(liveView(decodeJson(view?.body)));

    expect([input?.language, output?.language]).toEqual(['json', 'json']);
    expect(await run.executing(campaignReviews, decodeJson(input?.body))).toMatchObject(
      Exit.succeed({ output: decodeJson(output?.body) }),
    );
  });
});
