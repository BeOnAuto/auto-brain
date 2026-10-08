import { Ledger } from '@beonauto/operations';
import {
  deferredCanceller,
  outboundCallRecorder,
  replyRecorder,
  type Primitive,
  type RecordedOutboundCall,
} from '@beonauto/specs';
import { Effect, Layer, Schema } from 'effect';

import { askedRunId } from './asked-requests.ts';
import type { HarnessLedger } from './interaction-harness.ts';

const Settle = Schema.Struct({ type: Schema.Literal('settle') });

const isSettlement = Schema.is(Schema.Union([Settle, Schema.Struct({ command: Settle })]));

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

export const takenReply = { id: '1699.2', sender: 'ada' };

export interface RacingDelivery {
  readonly ledger: HarnessLedger;
  readonly started: () => Promise<void>;
  readonly cancelSettled: (primitive: Primitive) => Promise<void>;
}

function replyTakenIn(ledger: HarnessLedger, answer: Schema.Json): Effect.Effect<RecordedOutboundCall, unknown> {
  return replyRecorder(ledger.service)(
    address,
    { type: 'reply_taken', server: 'chat', tool: 'thread_replies', reply: takenReply, answer },
    lineage,
  );
}

export function recordedReply(ledger: HarnessLedger, answer: Schema.Json): Promise<unknown> {
  return Effect.runPromise(replyTakenIn(ledger, answer));
}

function broughtOf(
  ledger: HarnessLedger,
  answer: Schema.Json | undefined,
): Effect.Effect<RecordedOutboundCall, unknown> {
  return answer === undefined
    ? outboundCallRecorder(ledger.service)(
        address,
        { type: 'delivery_ended', number: 1, outcome: 'delivered', duration_ms: 3 },
        lineage,
      )
    : replyTakenIn(ledger, answer);
}

export function broughtBeforeSettling(ledger: HarnessLedger, answer?: Schema.Json): RacingDelivery {
  const brought = broughtOf(ledger, answer);
  const pending = { bringing: true };
  const service: Ledger['Service'] = {
    ...ledger.service,
    execute: (stream, decider, command, given) => {
      const settling = ledger.service.execute(stream, decider, command, given);
      if (!isSettlement(command) || !pending.bringing) {
        return settling;
      }
      pending.bringing = false;
      return Effect.andThen(Effect.orDie(brought), settling);
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
          outboundCallRecorder(ledger.service)(
            address,
            { type: 'delivery_started', number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
            lineage,
          ),
        ),
      ),
  };
}
