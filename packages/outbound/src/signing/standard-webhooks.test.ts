import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  isSignedWebhook,
  signedWebhookHeaders,
  webhookKeyOf,
  webhookSecretProblem,
  type ReceivedWebhook,
} from '../index.ts';

const specimen = {
  secret: Redacted.make('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'),
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1_614_265_330,
  body: '{"test": 2432232314}',
};

function independentlySigned(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/u, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

describe('a webhook signed as Standard Webhooks signs one', () => {
  it('carries its id, its time in seconds and the signature of the specification', () => {
    expect(signedWebhookHeaders(specimen.secret, specimen)).toEqual({
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
  });

  it('is verified by a check written apart from the signing, for any body', () => {
    const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
    const webhook = { id: 'm-1', timestamp: 1_700_000_000, body: '{"type":"interaction_requested","data":{"é":1}}' };

    expect(signedWebhookHeaders(Redacted.make(secret), webhook)['webhook-signature']).toBe(
      independentlySigned(secret, webhook.id, webhook.timestamp, webhook.body),
    );
  });
});

describe('a received webhook', () => {
  const headers = signedWebhookHeaders(specimen.secret, specimen);

  it('is taken when its signature is one of those it carries and its time is near', () => {
    expect(
      isSignedWebhook(specimen.secret, {
        headers: { ...headers, 'webhook-signature': `v1,c29tZXRoaW5nZWxzZQ== ${String(headers['webhook-signature'])}` },
        body: specimen.body,
        nowSeconds: specimen.timestamp + 299,
      }),
    ).toBe(true);
  });

  const refused: ReadonlyArray<readonly [string, ReceivedWebhook]> = [
    ['another body', { headers, body: '{"test": 1}', nowSeconds: specimen.timestamp }],
    ['a time too far gone', { headers, body: specimen.body, nowSeconds: specimen.timestamp + 301 }],
    [
      'no id',
      { headers: { ...headers, 'webhook-id': undefined }, body: specimen.body, nowSeconds: specimen.timestamp },
    ],
    [
      'no signature',
      { headers: { ...headers, 'webhook-signature': undefined }, body: specimen.body, nowSeconds: specimen.timestamp },
    ],
    [
      'a time that is no number',
      { headers: { ...headers, 'webhook-timestamp': 'soon' }, body: specimen.body, nowSeconds: specimen.timestamp },
    ],
  ];

  it.each(refused)('is refused with %s', (_case, received) => {
    expect(isSignedWebhook(specimen.secret, received)).toBe(false);
  });
});

describe('the secret of a webhook', () => {
  it('is its key in base64 after whsec_', () => {
    expect(webhookKeyOf(specimen.secret)).toEqual(Buffer.from('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'base64'));
    expect(webhookSecretProblem('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).toBeUndefined();
  });

  it.each([
    [
      'plain text',
      'not-a-secret',
      'Expected a secret in the Standard Webhooks form, whsec_ and then its key in base64',
    ],
    [
      'text that is not base64',
      'whsec_***',
      'Expected a secret in the Standard Webhooks form, whsec_ and then its key in base64',
    ],
    [
      'a key too short',
      `whsec_${Buffer.alloc(8).toString('base64')}`,
      'Expected a key of 24 to 64 bytes after whsec_, not 8',
    ],
    [
      'a key too long',
      `whsec_${Buffer.alloc(65).toString('base64')}`,
      'Expected a key of 24 to 64 bytes after whsec_, not 65',
    ],
  ])('is refused as %s', (_case, written, problem) => {
    expect(webhookSecretProblem(written)).toBe(problem);
  });
});
