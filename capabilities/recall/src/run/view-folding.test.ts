import type { FoldRequest, ProgramPool } from '@beonauto/workflow-engine/dsl';
import type { ViewDetails } from '@beonauto/workflow-host';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { poolOf, workerTestTimeoutMs } from '../testing/recall-runs.ts';
import { runnableDetailsOf } from '../testing/runnable-details.ts';
import { recallFolding } from './recall-bounds.ts';

function review(at: string, output: Schema.Json): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: `run-${at}`,
    source: `/runs/${at}`,
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time: at,
    data: { type: 'reasoning', name: 'review-brief', version: 1, output },
  };
}

function folded(pool: ProgramPool, details: ViewDetails, events: readonly Schema.JsonObject[]) {
  const { fold, filters, initial, schema } = details;
  const request: FoldRequest = {
    ...recallFolding,
    events,
    views: [
      {
        fold,
        filters,
        view: initial,
        ...(schema === undefined ? {} : { schema }),
        events: events.map((_, index) => index),
      },
    ],
    waitMs: 5000,
    deadlineMs: 20_000,
  };
  return pool.fold(request);
}

describe('the checked worker, folding the views of recall functions', { timeout: workerTestTimeoutMs }, () => {
  it('folds the example over the runs it names, in order, checking the view against its schema after each fold', async () => {
    const events = [
      review('2026-10-06T10:00:00.000Z', { campaign: 'spring', verdict: 'approve' }),
      review('2026-10-06T10:00:01.000Z', 'a plain text answer'),
      review('2026-10-06T10:00:02.000Z', { campaign: 'spring', verdict: 'reject' }),
    ];

    expect(await folded(poolOf(), await runnableDetailsOf(campaignReviews), events)).toMatchObject({
      ran: 'folded',
      views: [
        {
          folded: 3,
          view: {
            unknown: [{ at: '2026-10-06T10:00:01.000Z', verdict: 'none', run: '/runs/2026-10-06T10:00:01.000Z' }],
            spring: [
              { at: '2026-10-06T10:00:00.000Z', verdict: 'approve', run: '/runs/2026-10-06T10:00:00.000Z' },
              { at: '2026-10-06T10:00:02.000Z', verdict: 'reject', run: '/runs/2026-10-06T10:00:02.000Z' },
            ],
          },
        },
      ],
    });
  });

  it('stops a view at the event after which its schema refuses it, naming where', async () => {
    const front =
      'language: typescript\nsource:\n  events:\n    - type: run_succeeded\nview:\n  initial: {}\n  schema: {additionalProperties: {type: integer}}';
    const details = await runnableDetailsOf(
      recallDocument(foldOf('return { ...view, [event.time]: event.data.output };'), front),
    );
    const events = [review('2026-10-06T10:00:00.000Z', 1), review('2026-10-06T10:00:01.000Z', 'two')];

    expect(await folded(poolOf(), details, events)).toMatchObject({
      ran: 'folded',
      views: [
        {
          view: { '2026-10-06T10:00:00.000Z': 1 },
          folded: 1,
          stall: { at: 1, kind: 'schema', message: '/2026-10-06T10:00:01.000Z: Expected number' },
        },
      ],
    });
  });
});
