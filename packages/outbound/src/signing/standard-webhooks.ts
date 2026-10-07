import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Redacted } from 'effect';

export type WebhookSecret = Redacted.Redacted;

export interface SignedWebhook {
  readonly id: string;
  readonly timestamp: number;
  readonly body: string;
}

export interface ReceivedWebhook {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  readonly nowSeconds: number;
}

const secretPrefix = 'whsec_';

const fewestKeyBytes = 24;

const mostKeyBytes = 64;

const toleranceSeconds = 300;

const base64 = /^[A-Za-z0-9+/]+={0,2}$/u;

export function webhookSecretProblem(written: string): string | undefined {
  const encoded = written.startsWith(secretPrefix) ? written.slice(secretPrefix.length) : undefined;
  if (encoded === undefined || !base64.test(encoded)) {
    return `Expected a secret in the Standard Webhooks form, ${secretPrefix} and then its key in base64`;
  }
  const bytes = Buffer.from(encoded, 'base64').length;
  return bytes >= fewestKeyBytes && bytes <= mostKeyBytes
    ? undefined
    : `Expected a key of ${fewestKeyBytes} to ${mostKeyBytes} bytes after ${secretPrefix}, not ${bytes}`;
}

export function webhookKeyOf(secret: WebhookSecret): Buffer {
  return Buffer.from(Redacted.value(secret).slice(secretPrefix.length), 'base64');
}

function signatureOf(secret: WebhookSecret, { id, timestamp, body }: SignedWebhook): string {
  return createHmac('sha256', webhookKeyOf(secret)).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

export function signedWebhookHeaders(secret: WebhookSecret, webhook: SignedWebhook): Readonly<Record<string, string>> {
  return {
    'webhook-id': webhook.id,
    'webhook-timestamp': String(webhook.timestamp),
    'webhook-signature': `v1,${signatureOf(secret, webhook)}`,
  };
}

function sameText(left: string, right: string): boolean {
  const first = Buffer.from(left, 'utf8');
  const second = Buffer.from(right, 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

export function isSignedWebhook(secret: WebhookSecret, { headers, body, nowSeconds }: ReceivedWebhook): boolean {
  const id = headers['webhook-id'];
  const timestamp = Number(headers['webhook-timestamp']);
  const signatures = (headers['webhook-signature'] ?? '').split(' ');
  if (id === undefined || !Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = `v1,${signatureOf(secret, { id, timestamp, body })}`;
  return signatures.some((signature) => sameText(signature, expected));
}
