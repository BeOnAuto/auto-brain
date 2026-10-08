import { Ledger } from '@beonauto/operations';
import { deferredCanceller, outboundCallRecorder, type DeliveryEndedFact, type Primitive } from '@beonauto/specs';
import { Effect, Layer, Schema } from 'effect';

import type { HarnessLedger } from './interaction-harness.ts';
import { askedRunId } from './webhook-requests.ts';

const Settle = Schema.Struct({ type: Schema.Literal('settle') });

const isSettlement = Schema.is(Schema.Union([Settle, Schema.Struct({ command: Settle })]));

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

export interface RacingDelivery {
  readonly ledger: HarnessLedger;
  readonly started: () => Promise<void>;
  readonly cancelSettled: (primitive: Primitive) => Promise<void>;
}

function endingOf(answer: Schema.Json | undefined): DeliveryEndedFact {
  return answer === undefined
    ? { type: 'delivery_ended', number: 1, outcome: 'delivered', status: 200, duration_ms: 3 }
    : { type: 'delivery_ended', number: 1, outcome: 'answered', status: 200, answer, duration_ms: 3 };
}

export function deliveryEndedBeforeSettling(ledger: HarnessLedger, answer?: Schema.Json): RacingDelivery {
  const recorded = outboundCallRecorder(ledger.service);
  const ended = recorded(address, endingOf(answer), lineage);
  const pending = { ending: true };
  const service: Ledger['Service'] = {
    ...ledger.service,
    execute: (stream, decider, command, given) => {
      const settling = ledger.service.execute(stream, decider, command, given);
      if (!isSettlement(command) || !pending.ending) {
        return settling;
      }
      pending.ending = false;
      return Effect.andThen(Effect.orDie(ended), settling);
    },
  };
  return {
    ledger: { service, layer: Layer.succeed(Ledger, service) },
    cancelSettled: (primitive) =>
      Effect.runPromise(
        deferredCanceller([primitive], service)(
          address,
          { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
          lineage,
        ),
      ),
    started: () =>
      Effect.runPromise(
        Effect.asVoid(
          recorded(address, { type: 'delivery_started', number: 1, channel: 'partner', target: 'ada' }, lineage),
        ),
      ),
  };
}
