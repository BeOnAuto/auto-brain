import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { answersRequest, answerTokenOf } from '../index.ts';

const secret = Redacted.make(`whsec_${Buffer.alloc(32, 3).toString('base64')}`);

const otherSecret = Redacted.make(`whsec_${Buffer.alloc(32, 4).toString('base64')}`);

const request = '0d0b9a1e-6c51-5d7a-9a4e-0f6b2c1d3e4f';

describe('the answer token of a request', () => {
  const token = answerTokenOf(secret, request);

  it('is the same every time for one request, unpadded base64url text, and answers that request alone', () => {
    expect(answerTokenOf(secret, request)).toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(answersRequest(secret, request, token)).toBe(true);
    expect(answersRequest(secret, 'another-request', token)).toBe(false);
    expect(answersRequest(otherSecret, request, token)).toBe(false);
  });

  it('is not the signature a webhook would carry, since its key is derived for this purpose alone', () => {
    const key = Buffer.from(Redacted.value(secret).slice('whsec_'.length), 'base64');

    expect(token).not.toBe(createHmac('sha256', key).update(request).digest('base64url'));
  });

  it.each(['', 'short', `${token}A`, token.toUpperCase()])('refuses the token %j', (presented) => {
    expect(answersRequest(secret, request, presented)).toBe(false);
  });
});
