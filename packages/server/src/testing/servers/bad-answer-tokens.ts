import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { partnerSecret } from '@beonauto/interaction/testing';
import { answerTokenOf } from '@beonauto/outbound';
import { Redacted, Schema } from 'effect';

import type { InteractionServer } from './interaction-server.ts';
import { alpha } from './reasoning-server.ts';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
);

const decodeRequestIds = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.String));

const differsByRequest = new Set(['date', 'x-request-id']);

export async function requestIdOf(server: InteractionServer, runId: string): Promise<string> {
  const { events } = decodeHistory((await server.call('GET', `${alpha}/executions/${runId}/history`)).body);
  return decodeRequestIds(events.filter(({ type }) => type === 'interaction_requested').map(({ id }) => id))[0];
}

export function badAnswerTokens(delivered: string, inboxRequestId: string): readonly string[] {
  const requestId = delivered.slice(0, delivered.lastIndexOf('.'));
  return [
    'abcdef',
    'x.y',
    `${requestId}.${Buffer.alloc(32, 1).toString('base64url')}`,
    createHmac('sha256', partnerSecret).update(requestId).digest('base64url'),
    delivered,
    answerTokenOf(Redacted.make(partnerSecret), inboxRequestId),
    `${requestId}.`,
    '.',
  ];
}

export async function answeredAs(server: InteractionServer, path: string, token: string): Promise<readonly unknown[]> {
  const { status, headers, text } = await server.call('POST', path, {
    body: { answer: { choice: 'approve' } },
    authorization: `Request ${token}`,
  });
  return [
    status,
    [...headers.keys()].filter((name) => !differsByRequest.has(name)).map((name) => [name, headers.get(name)]),
    text,
  ];
}
