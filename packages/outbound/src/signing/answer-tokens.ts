import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { webhookKeyOf, type WebhookSecret } from './standard-webhooks.ts';

const purpose = 'auto-brain answer token v1';

function tokenKeyOf(secret: WebhookSecret): Buffer {
  return createHmac('sha256', webhookKeyOf(secret)).update(purpose, 'utf8').digest();
}

function digestOf(secret: WebhookSecret, messageId: string): Buffer {
  return createHmac('sha256', tokenKeyOf(secret)).update(messageId, 'utf8').digest();
}

export function answerTokenOf(secret: WebhookSecret, messageId: string): string {
  return digestOf(secret, messageId).toString('base64url');
}

export function answersRequest(secret: WebhookSecret, messageId: string, token: string): boolean {
  const presented = Buffer.from(token, 'base64url');
  const expected = digestOf(secret, messageId);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
