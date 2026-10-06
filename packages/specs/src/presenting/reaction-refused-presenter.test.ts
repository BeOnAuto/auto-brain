import { presentationOf } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ReactionRefusedSchema, type ReactionRefused } from '../events/reaction-refusals.ts';
import { makeSpecPresenters } from '../index.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeSpecPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(ReactionRefusedSchema));

const refused: ReactionRefused = {
  type: 'reaction_refused',
  workflow: 'close-the-month',
  count: 3,
  reason: 'An event matched the trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach',
  minute: '2026-10-01T09:00:00.000Z',
  at: '2026-10-01T09:01:00.000Z',
};

describe('the presenter of the refused reactions of a workflow', () => {
  it('says in words that the workflow was not started for everything it matched, and gives the count and the last reason', () => {
    expect(
      present({
        id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9e',
        cursor: 'c-1',
        causationId: null,
        correlationId: null,
        stream: 'reactions/close-the-month',
        version: 1,
        type: 'reaction_refused',
        data: encode(refused),
        recordedAt: '2026-10-01T09:01:00.000Z',
      }),
    ).toEqual([
      {
        id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9e',
        cursor: 'c-1',
        causation_id: null,
        at: '2026-10-01T09:01:00.000Z',
        type: 'reaction_refused',
        summary:
          'The workflow “close-the-month” was not started for everything its trigger matched in a minute; the details say how often and why.',
        data: {
          workflow: 'close-the-month',
          count: 3,
          reason: refused.reason,
          minute: '2026-10-01T09:00:00.000Z',
        },
      },
    ]);
  });
});
