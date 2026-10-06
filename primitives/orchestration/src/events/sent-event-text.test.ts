import { memoryLedger } from '@beonauto/operations/testing';
import { echo } from '@beonauto/specs/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { defineSendExecutionEvent } from './send-execution-event.ts';

const brain = brainOn(memoryLedger(), [echo]);

const sendEvent = defineSendExecutionEvent({ deliver: () => Effect.die('An event was delivered') });

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const unspeakable = ['\u0000', '\u001F', '\u007F', '\u009F', '\uD800', '\uDC00', '\uFFFE', '\uFDD0'];

const IssuesSchema = Schema.Struct({ issues: Schema.Array(Schema.Struct({ pointer: Schema.String })) });

function pointersOf(outcome: unknown): readonly string[] {
  return Schema.decodeUnknownSync(IssuesSchema)(outcome).issues.map(({ pointer }) => pointer);
}

function sending(event: object) {
  return brain.call(sendEvent, { execution_id: executionId, event });
}

describe('the text of an event sent to a run', () => {
  it('holds no control character, unpaired surrogate or noncharacter, as an event published to the brain', async () => {
    const sent = await Promise.all(
      unspeakable.map((character) =>
        sending({ type: `t${character}`, id: `i${character}`, source: `s${character}`, subject: `s${character}` }),
      ),
    );

    expect(sent.map((outcome) => pointersOf(outcome))).toEqual(
      unspeakable.map(() => ['/event/type', '/event/source', '/event/subject', '/event/id']),
    );
  });

  it('names its type, id and subject with a character that is not a space', async () => {
    expect(pointersOf(await sending({ type: ' ', id: ' ', subject: '' }))).toEqual([
      '/event/type',
      '/event/subject',
      '/event/id',
    ]);
  });

  it('takes text in any script, emoji included', async () => {
    expect(await sending({ type: 'com.acme.grüße', subject: '😀 a reply' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});
