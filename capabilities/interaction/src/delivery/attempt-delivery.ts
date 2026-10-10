import type { OneCall, StartedFields } from '@beonauto/mcp';
import { deliveryIdKey, runIdKey } from '@beonauto/mcp/policy';
import { Effect, Result, type Schema } from 'effect';

import type { DeliveringRecord } from '../run/request-record.ts';
import type { DeliveryParts, DueRequest } from '../schedule/delivery-parts.ts';
import { recordedCall } from '../schedule/request-ledger.ts';
import { argumentsFailureWords, deliveryVariablesOf, renderedArguments } from '../tool-blocks/rendered-arguments.ts';
import { endOf, type AttemptEnd } from './attempt-end.ts';
import { startedFact, type Attempting } from './attempt-facts.ts';

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

function callOf({ request, record }: DeliveryPlan, input: OneCall['input']): OneCall {
  const { address, row } = request;
  return {
    org: address.org,
    brain: address.brain,
    reference: { server: record.deliver.server, tool: record.deliver.tool },
    input,
    meta: { [runIdKey]: address.id, [deliveryIdKey]: row.request_id },
  };
}

export function deliveredOnce(parts: DeliveryParts, plan: DeliveryPlan): Effect.Effect<Delivered | undefined> {
  const { request, record, input } = plan;
  const asking = { input, runId: request.address.id, functionName: request.row.function };
  const rendered = renderedArguments(record.deliver.with, deliveryVariablesOf(record, asking));
  if (Result.isFailure(rendered)) {
    const { failure } = rendered;
    const end: AttemptEnd = {
      type: 'delivery_refused',
      data: {
        because: failure.reason === 'too_large' ? 'too_large' : 'unworkable',
        detail: argumentsFailureWords(failure, 'the call that delivers the request'),
      },
    };
    return Effect.map(recordedStart(parts, plan), (startedId): Delivered | undefined =>
      startedId === undefined ? undefined : { startedId, end },
    );
  }
  const call = callOf(plan, rendered.success.input);
  return Effect.flatMap(
    Effect.flatMap(parts.tools.startOf(call), (fields) => recordedStart(parts, plan, fields)),
    (startedId) =>
      startedId === undefined
        ? Effect.undefined
        : Effect.map(parts.tools.callOnce(call), (called): Delivered => ({ startedId, end: endOf(called, record) })),
  );
}
