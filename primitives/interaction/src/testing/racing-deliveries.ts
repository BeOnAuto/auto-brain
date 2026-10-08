import { Ledger } from '@beonauto/operations';
import { deferredCanceller, outboundCallRecorder, type Primitive } from '@beonauto/specs';
import { Effect, Layer, Schema } from 'effect';

import type { HarnessLedger } from './interaction-harness.ts';
import { askedRunId } from './webhook-requests.ts';

const isSettlement = Schema.is(Schema.Struct({ type: Schema.Literal('settle') }));

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

export interface RacingDelivery {
  readonly ledger: HarnessLedger;
  readonly started: () => Promise<void>;
  readonly cancelSettled: (primitive: Primitive) => Promise<void>;
}

export function answeredByDeliveryBeforeSettling(ledger: HarnessLedger, answer: Schema.Json): RacingDelivery {
  const recorded = outboundCallRecorder(ledger.service);
  const ended = recorded(
    address,
    { type: 'delivery_ended', number: 1, outcome: 'answered', status: 200, answer, duration_ms: 3 },
    lineage,
  );
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
