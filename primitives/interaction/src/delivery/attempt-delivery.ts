import type { AnsweredOnce, CalledOnce, DeliveryCall, StartedFields } from '@beonauto/mcp';
import { deliveryIdKey, executionIdKey } from '@beonauto/mcp/policy';
import { Effect, Result, type Schema } from 'effect';

import { deliveryVariablesOf, renderedArguments } from '../route/rendered-arguments.ts';
import type { DeliveringRecord } from '../run/request-record.ts';
import type { DeliveryParts, DueRequest } from '../schedule/delivery-parts.ts';
import { recordedCall } from '../schedule/request-ledger.ts';
import type { AttemptEnd } from './attempt-end.ts';
import { startedFact, type Attempting } from './attempt-facts.ts';
import { endOfCall } from './call-ends.ts';

export interface Delivered {
  readonly startedId: string;
  readonly end: AttemptEnd;
}

export interface DeliveryPlan {
  readonly request: DueRequest;
  readonly record: DeliveringRecord;
  readonly input: Schema.Json;
  readonly attempting: Attempting;
}

function detailOf(detail: string) {
  return detail === '' ? {} : { detail };
}

function endOfAnswer(called: AnsweredOnce): AttemptEnd {
  const end = endOfCall(called);
  if ('answered' in end) {
    return { outcome: 'delivered', ...called.fields };
  }
  const { because, retryAfterMs, detail } = end.failed;
  return {
    outcome: 'failed',
    because,
    ...(retryAfterMs === null ? {} : { retry_after_ms: retryAfterMs }),
    ...detailOf(detail),
    ...called.fields,
  };
}

function endOf(called: CalledOnce): AttemptEnd {
  if (called.kind === 'not_offered') {
    return { outcome: 'failed', because: 'tool_not_offered', ...detailOf(called.detail) };
  }
  if (called.kind === 'unopened') {
    return { outcome: 'failed', because: 'server_failure', ...detailOf(called.detail) };
  }
  return endOfAnswer(called);
}

function recordedStart(
  parts: DeliveryParts,
  { request, attempting }: DeliveryPlan,
  call?: StartedFields,
): Effect.Effect<string | undefined> {
  return Effect.map(
    recordedCall(parts.ledger, request.address, startedFact(attempting, call), request.lineage),
    (made) => made?.id,
  );
}

function callOf({ request, record }: DeliveryPlan, input: DeliveryCall['input']): DeliveryCall {
  const { address, row } = request;
  return {
    org: address.org,
    brain: address.brain,
    reference: { server: record.deliver.server, tool: record.deliver.tool },
    input,
    meta: { [executionIdKey]: address.id, [deliveryIdKey]: row.request_id },
  };
}

export function deliveredOnce(parts: DeliveryParts, plan: DeliveryPlan): Effect.Effect<Delivered | undefined> {
  const { request, record, input } = plan;
  const asking = { input, runId: request.address.id, functionName: request.row.function };
  const rendered = renderedArguments(record.deliver.with, deliveryVariablesOf(record, asking));
  if (Result.isFailure(rendered)) {
    return Effect.map(recordedStart(parts, plan), (startedId): Delivered | undefined =>
      startedId === undefined ? undefined : { startedId, end: { outcome: 'refused', because: 'too_large' } },
    );
  }
  const call = callOf(plan, rendered.success.input);
  return Effect.flatMap(recordedStart(parts, plan, parts.tools.startOf(call)), (startedId) =>
    startedId === undefined
      ? Effect.undefined
      : Effect.map(parts.tools.callOnce(call), (called): Delivered => ({ startedId, end: endOf(called) })),
  );
}
