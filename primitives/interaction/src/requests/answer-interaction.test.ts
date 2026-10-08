import { requestTokenCallerOf } from '@beonauto/operations';
import { deferredCanceller } from '@beonauto/specs';
import { Effect, Result, Schema, SchemaTransformation } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  acmeAdmin,
  approvalDocument,
  askedRunId,
  askedThroughPartner,
  interactionHarness,
  notificationDocument,
} from '../testing/index.ts';
import { checkedAnswer } from './answer-check.ts';
import { defineAnswerInteraction } from './answer-interaction.ts';
import { listInteractions } from './list-interactions.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const answer = defineAnswerInteraction({ channels: new Map(), secrets: [] });

const someText: unknown = expect.any(String);

const pastTheBound: unknown = expect.stringContaining('65536');

const outputOf = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.JsonObject }).pipe(
    Schema.decodeTo(
      Schema.JsonObject,
      SchemaTransformation.transform({
        decode: ({ output }) => output,
        encode: (output) => ({ status: 'succeeded' as const, output }),
      }),
    ),
  ),
);

const interaction = {
  execution_id: runId,
  function: 'approve-brief',
  version: 1,
  to: 'ada',
  channel: 'inbox',
  message: 'Approve?',
  takes_answer: true,
  answer_schema: { type: 'object' },
  requested_at: '2026-10-07T09:00:00.000Z',
  expires_at: '2026-10-09T09:00:00.000Z',
  attempts: 0,
  standing: 'in_inbox',
};

async function askedApproval() {
  const brain = interactionHarness();
  await brain.define('approve-brief', approvalDocument());
  const asked = await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { brain, asked };
}

describe('a request asked through the inbox', () => {
  it('waits as a started run, listed among the open requests of the brain', async () => {
    const { brain, asked } = await askedApproval();

    expect(asked).toMatchObject({ status: 'succeeded', output: { execution_id: runId, status: 'started' } });
    expect(await brain.call(listInteractions, {})).toMatchObject({
      status: 'succeeded',
      output: {
        interactions: [
          {
            execution_id: runId,
            function: 'approve-brief',
            version: 1,
            to: 'ada',
            channel: 'inbox',
            message: 'Please review the brief for Spring.',
            takes_answer: true,
            attempts: 0,
            standing: 'in_inbox',
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('an answer to a request', () => {
  it('settles its run with the answer as its output, recorded with who answered and the claim', async () => {
    const { brain } = await askedApproval();

    const answered = await brain.call(answer, {
      execution_id: runId,
      answer: { choice: 'approve' },
      claimed_for: 'ada',
    });

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { execution_id: runId, status: 'succeeded', output: { choice: 'approve' } },
    });
    expect(await brain.runOf(runId)).toMatchObject({
      output: {
        status: 'succeeded',
        record: { answered_by: acmeAdmin.id, claimed_for: 'ada', answered_at: someText },
      },
    });
    expect(await brain.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
  });

  it('answers what landed for the same answer again, and is a conflict for another one', async () => {
    const { brain } = await askedApproval();
    await brain.call(answer, { execution_id: runId, answer: { choice: 'approve' } });

    expect([
      await brain.call(answer, { execution_id: runId, answer: { choice: 'approve' } }),
      await brain.call(answer, { execution_id: runId, answer: { choice: 'reject' } }),
    ]).toMatchObject([
      { status: 'succeeded', output: { status: 'succeeded' } },
      { status: 'rejected', reason: 'conflict', detail: 'The run already ended with another result' },
    ]);
  });
});

describe('an answer the request does not take', () => {
  it('is invalid input when it does not match the answer schema, with pointers, and leaves the request open', async () => {
    const { brain } = await askedApproval();

    expect(await brain.call(answer, { execution_id: runId, answer: { choice: 'maybe' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/answer/choice' }],
    });
    expect(await brain.call(listInteractions, {})).toMatchObject({
      output: { interactions: [{ execution_id: runId }] },
    });
  });

  it('is refused for a run there is not, a run that asks nothing, and a notification', async () => {
    const brain = interactionHarness();
    await brain.define('tell', notificationDocument('inbox'));
    await brain.ask('tell', { campaign: 'Spring', owner: 'ada' }, otherRunId);

    expect([
      await brain.call(answer, { execution_id: runId, answer: {} }),
      await brain.call(answer, { execution_id: otherRunId, answer: {} }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run is not a request of an interaction function that waits for an answer',
      },
    ]);
  });
});

describe('an answer that is refused before it is checked', () => {
  it('is a conflict for a notification that waits for its delivery, and forbidden with a token for a run without a request', async () => {
    const { brain } = await askedThroughPartner({ notification: true });
    const inbox = interactionHarness();

    expect([
      await brain.call(answer, { execution_id: askedRunId, answer: {} }),
      await inbox.call(answer, { execution_id: askedRunId, answer: {} }, requestTokenCallerOf('acme', 'AAAA')),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', detail: 'The request is a notification, which takes no answer' },
      { status: 'rejected', reason: 'forbidden' },
    ]);
  });

  it('is invalid input past 64 KiB, and the answer schema of a request that cannot be read is no answer', async () => {
    const { brain } = await askedApproval();

    expect([
      await brain.call(answer, { execution_id: runId, answer: { choice: 'approve', note: 'x'.repeat(70_000) } }),
      checkedAnswer({}, { type: 'thing' }),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/answer', detail: pastTheBound }],
      },
      Result.fail([{ pointer: '', detail: 'The answer schema of the request cannot be read' }]),
    ]);
  });
});

describe('the words of answers and requests', () => {
  it('is told in plain words, as the requests are', async () => {
    const { brain } = await askedApproval();
    const answered = outputOf(await brain.call(answer, { execution_id: runId, answer: { choice: 'approve' } }));
    const listing = outputOf(await brain.call(listInteractions, {}));
    const input = { execution_id: runId, answer: { choice: 'approve' } };

    expect([
      answer.registration.plainLanguage?.attempt(input),
      answer.registration.plainLanguage?.outcome(answered, input),
      listInteractions.registration.plainLanguage?.attempt({}),
      listInteractions.registration.plainLanguage?.outcome(listing, {}),
      listInteractions.registration.plainLanguage?.outcome(
        { interactions: [interaction], has_more: false, next_cursor: null },
        {},
      ),
    ]).toEqual([
      'answer the request',
      'The request is answered: the run that asked it succeeded, with the answer as its output.',
      'list the open requests',
      'No request is waiting.',
      'Found 1 request waiting on this page.',
    ]);
  });
});

describe('a request whose run is cancelled', () => {
  it('ends rejected as cancelled with the kind asked, closes, and takes no answer after', async () => {
    const { brain } = await askedApproval();

    expect(await brain.cancel(runId)).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    await Effect.runPromise(
      deferredCanceller([brain.primitive], brain.ledger.service)(
        { org: 'acme', brain: 'alpha', id: runId },
        { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        { causationId: null, correlationId: runId },
      ),
    );

    expect(await brain.runOf(runId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed any more' },
      },
    });
    expect(await brain.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
    expect(await brain.call(answer, { execution_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      reason: 'conflict',
    });
  });
});
