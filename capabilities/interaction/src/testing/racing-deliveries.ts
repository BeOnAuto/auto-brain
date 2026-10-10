import {
  deferredCanceller,
  outboundCallRecorder,
  replyRecorder,
  type Capability,
  type RecordedOutboundCall,
} from '@beonauto/definitions';
import { Ledger } from '@beonauto/operations';
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
  readonly cancelSettled: (capability: Capability) => Promise<void>;
}

function replyTakenIn(ledger: HarnessLedger, answer: Schema.Json): Effect.Effect<RecordedOutboundCall, unknown> {
  return replyRecorder(ledger.service)(
    address,
    { type: 'reply_taken', data: { server: 'chat', tool: 'thread_replies', reply: takenReply, answer } },
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
        {
          type: 'delivery_succeeded',
          data: {
            number: 1,
            result_bytes: 2,
            result_sha256: 'd'.repeat(64),
            content_kept: true,
            duration_ms: 3,
            jsonrpc_id: 1,
          },
        },
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
    cancelSettled: (capability) =>
      Effect.runPromise(
        deferredCanceller([capability], service)(
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
            { type: 'delivery_started', data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' } },
            lineage,
          ),
        ),
      ),
  };
}
