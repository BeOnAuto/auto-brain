import { Buffer } from 'node:buffer';

import {
  answerTokenOf,
  postedOutbound,
  signedWebhookHeaders,
  type OutboundFetch,
  type PostOutcome,
} from '@beonauto/outbound';
import { Option, Redacted, Result, Schema } from 'effect';

import type { WebhookChannel } from '../channels/channel-settings.ts';
import { checkedAnswer } from '../requests/answer-check.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { endedAs, type AttemptEnd, type RequestAddress } from './attempt-end.ts';

export interface WebhookAttempt {
  readonly channel: WebhookChannel;
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly answerSchema: Schema.JsonObject | undefined;
  readonly origin: string;
  readonly fetch?: OutboundFetch;
  readonly nowMs: number;
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function answerPathOf({ org, brain, id }: RequestAddress): string {
  return `/v1/orgs/${org}/brains/${brain}/executions/${id}/answer`;
}

function requestEventOf(attempt: WebhookAttempt): Schema.JsonObject {
  const { address, row, origin, answerSchema } = attempt;
  return {
    specversion: '1.0',
    id: row.request_id,
    source: `${origin}/v1/orgs/${address.org}/brains/${address.brain}/executions/${address.id}`,
    type: 'interaction_requested',
    subject: `interaction/${row.function}`,
    time: new Date(row.requested_at).toISOString(),
    datacontenttype: 'application/json',
    data: {
      origin,
      org: address.org,
      brain: address.brain,
      execution_id: address.id,
      function: row.function,
      version: row.version,
      to: row.party,
      message: row.message,
      expires_at: new Date(row.expires_at).toISOString(),
      ...(answerSchema === undefined
        ? {}
        : {
            answer_schema: answerSchema,
            answer_url: `${origin}${answerPathOf(address)}`,
            answer_token: answerTokenOf(attempt.channel.secret, row.request_id),
          }),
    },
  };
}

function answerOf(body: string, schema: Schema.JsonObject): AttemptEnd {
  const parsed = Option.getOrUndefined(decodeJson(body));
  if (parsed === undefined) {
    return endedAs({ outcome: 'failed', status: 200, because: 'not_json', response_bytes: Buffer.byteLength(body) });
  }
  return Result.match(checkedAnswer(parsed, schema), {
    onSuccess: (answer) => ({
      ended: { outcome: 'answered', status: 200, response_bytes: Buffer.byteLength(body) },
      answer,
    }),
    onFailure: (issues) =>
      endedAs({
        outcome: 'failed',
        status: 200,
        because: 'answer_invalid',
        response_bytes: Buffer.byteLength(body),
        detail: issues.map(({ pointer, detail }) => `${pointer === '' ? '/' : pointer}: ${detail}`).join('; '),
      }),
  });
}

function deliveredOf(outcome: Extract<PostOutcome, { kind: 'delivered' }>, attempt: WebhookAttempt): AttemptEnd {
  const schema = attempt.channel.answers && outcome.status === 200 ? attempt.answerSchema : undefined;
  if (schema === undefined) {
    return endedAs({ outcome: 'delivered', status: outcome.status, response_bytes: outcome.bytes });
  }
  return outcome.cut
    ? endedAs({ outcome: 'failed', status: 200, because: 'too_large', response_bytes: outcome.bytes })
    : answerOf(outcome.body, schema);
}

function endOf(outcome: PostOutcome, attempt: WebhookAttempt): AttemptEnd {
  if (outcome.kind === 'delivered') {
    return deliveredOf(outcome, attempt);
  }
  const status = outcome.status === null ? {} : { status: outcome.status };
  if (outcome.kind === 'refused') {
    return endedAs({ outcome: 'refused', ...status, because: outcome.because });
  }
  return endedAs({
    outcome: 'failed',
    ...status,
    because: outcome.because,
    ...(outcome.retryAfterMs === undefined ? {} : { retry_after_ms: outcome.retryAfterMs }),
  });
}

export async function deliveredByWebhook(attempt: WebhookAttempt): Promise<AttemptEnd> {
  const body = JSON.stringify(requestEventOf(attempt));
  const { channel, row, nowMs } = attempt;
  const headers = {
    ...Object.fromEntries(
      [...channel.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
    ),
    'content-type': 'application/cloudevents+json',
    ...signedWebhookHeaders(channel.secret, { id: row.request_id, timestamp: Math.floor(nowMs / 1000), body }),
  };
  const outcome = await postedOutbound({
    url: channel.url,
    headers,
    body,
    ...(attempt.fetch === undefined ? {} : { fetch: attempt.fetch }),
  });
  return endOf(outcome, attempt);
}
