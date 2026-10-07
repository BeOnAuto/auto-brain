import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, interactionHarness } from '../testing/index.ts';
import { listInteractions } from './list-interactions.ts';

const runIds = [
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73',
];

const PageSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({
    interactions: Schema.Array(Schema.Struct({ execution_id: Schema.String })),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const decodePage = Schema.decodeUnknownSync(PageSchema);

async function brainWithThreeRequests() {
  const brain = interactionHarness();
  await brain.define('approve-brief', approvalDocument());
  await brain.define('approve-budget', approvalDocument());
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, String(runIds[0]));
  await brain.ask('approve-budget', { campaign: 'Summer', owner: 'ada' }, String(runIds[1]));
  await brain.ask('approve-brief', { campaign: 'Autumn', owner: 'grace' }, String(runIds[2]));
  return brain;
}

async function listed(brain: Awaited<ReturnType<typeof brainWithThreeRequests>>, input: object) {
  const page = decodePage(await brain.call(listInteractions, input));
  return { ids: page.output.interactions.map(({ execution_id: id }) => id), page: page.output };
}

describe('the open requests of a brain', () => {
  it('are listed newest first, kept to one party or one function when asked', async () => {
    const brain = await brainWithThreeRequests();

    expect([
      (await listed(brain, {})).ids,
      (await listed(brain, { to: 'ada' })).ids,
      (await listed(brain, { function: 'approve-brief' })).ids,
      (await listed(brain, { to: 'ada', function: 'approve-brief' })).ids,
    ]).toEqual([runIds.toReversed(), [runIds[1], runIds[0]], [runIds[2], runIds[0]], [runIds[0]]]);
  });

  it('are read on from the cursor of a page, and refuse a cursor list_interactions did not give', async () => {
    const brain = await brainWithThreeRequests();
    const first = await listed(brain, { limit: 2 });

    expect(first).toMatchObject({ ids: [runIds[2], runIds[1]], page: { has_more: true } });
    expect(await listed(brain, { limit: 2, cursor: first.page.next_cursor })).toMatchObject({
      ids: [runIds[0]],
      page: { has_more: false, next_cursor: null },
    });
    expect(await brain.call(listInteractions, { cursor: 'bm90LWEtY3Vyc29y' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor' }],
    });
  });
});
