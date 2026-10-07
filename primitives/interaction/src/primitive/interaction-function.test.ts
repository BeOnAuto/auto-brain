import { makeSpecPresenters } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, interactionHarness, notificationDocument, webhookChannels } from '../testing/index.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';

describe('the interaction capability', () => {
  it('prepares a question to finish later within its expiry, and a notification to the inbox to finish at once', () => {
    const { primitive } = interactionHarness();

    expect([
      Effect.runSync(primitive.prepare(approvalDocument())),
      Effect.runSync(primitive.prepare(notificationDocument())),
      Effect.runSync(primitive.prepare(notificationDocument('partner'))),
    ]).toMatchObject([
      {
        finishesLater: true,
        longestRunMs: 172_800_000,
        whenCancelled: 'finish',
        summary: { details: { channel: 'inbox', expires: 'P2D' } },
      },
      { finishesLater: false, longestRunMs: 3_600_000 },
      { finishesLater: true },
    ]);
  });

  it('reaches outside and may change it only once the server offers a channel', () => {
    const offline = interactionHarness().primitive;
    const online = interactionHarness({ channels: webhookChannels('https://partner.example.com/requests') }).primitive;

    expect([offline.reachesOutside, offline.mayChangeOutside, online.reachesOutside, online.mayChangeOutside]).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('refuses a document it cannot read, counting its problems', () => {
    const { primitive } = interactionHarness();

    expect([
      Effect.runSync(Effect.flip(primitive.prepare('---\nchannel: inbox\n---\n'))).detail,
      Effect.runSync(Effect.flip(primitive.prepare('Hello'))).detail,
    ]).toEqual([
      'The interaction function definition has 3 problems',
      'The interaction function definition has a problem',
    ]);
  });
});

describe('the words of an interaction run', () => {
  it('show a request as waiting for an answer, and a notification as waiting to be delivered, without its message', () => {
    expect([
      interactionRunWords.deferral({
        channel: 'inbox',
        to: 'ada',
        message: 'Approve?',
        answer_schema: {},
        expires_at: '2026-10-09T09:00:00.000Z',
      }),
      interactionRunWords.deferral({
        channel: 'partner',
        to: 'a'.repeat(300),
        message: 'Out',
        expires_at: '2026-10-09T09:00:00.000Z',
      }),
      interactionRunWords.deferral({ run: 'not a request' }),
    ]).toEqual([
      {
        summary: 'A request is waiting for an answer, in the brain’s inbox, until 2026-10-09T09:00:00.000Z.',
        data: {
          channel: 'inbox',
          to: 'ada',
          message_bytes: 8,
          takes_answer: true,
          expires_at: '2026-10-09T09:00:00.000Z',
        },
      },
      {
        summary:
          'A notification is waiting to be delivered, through the channel “partner”, until 2026-10-09T09:00:00.000Z.',
        data: {
          channel: 'partner',
          to: 'a'.repeat(256),
          message_bytes: 3,
          takes_answer: false,
          expires_at: '2026-10-09T09:00:00.000Z',
        },
      },
      undefined,
    ]);
    expect(interactionRunWords.deferralType).toBe('interaction_requested');
  });
});

describe('the words of an answer', () => {
  it('say what the answer was, or that a notification was delivered', () => {
    expect([
      describeAnswer({}),
      describeAnswer({ choice: 'approve' }),
      describeAnswer('x'.repeat(5000)),
      describeAnswer([]),
    ]).toEqual([
      'It delivered its notification.',
      expect.stringContaining('Its answer:'),
      'Its answer is too long to repeat here; the whole of it is in the details below.',
      expect.stringContaining('Its answer'),
    ]);
  });

  it('name the deferral in the history by the type the brain reserves for requests', () => {
    const presenters = makeSpecPresenters([interactionHarness().primitive]);

    expect(presenters[0]?.publicNames['execution_deferred']).toEqual(['execution_deferred', 'interaction_requested']);
  });
});
