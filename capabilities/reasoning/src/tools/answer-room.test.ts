import { describe, expect, it } from 'vitest';

import { answerRoom, bytesPerToken, inputTokensOf } from './answer-room.ts';

describe('the room an answer has in what the model reads', () => {
  it('is what the window holds past the output and the conversation so far, in bytes, and none when it is full', () => {
    const messages = [{ role: 'user', content: 'hé' }];
    const sent = new TextEncoder().encode(JSON.stringify(messages)).byteLength;

    expect([
      answerRoom(1000, 200, messages),
      answerRoom(10, 200, messages),
      answerRoom(undefined, 200, messages),
    ]).toEqual([800 * bytesPerToken - sent, 0, undefined]);
  });
});

describe('the input tokens a run has spent', () => {
  it('add up every step the provider counted, and nothing for a step it did not', () => {
    expect(inputTokensOf([{ usage: { inputTokens: 30 } }, { usage: { inputTokens: undefined } }, { usage: {} }])).toBe(
      30,
    );
  });
});
