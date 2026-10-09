import {
  conversationCallDecider,
  conversationCallStreamOf,
  tellingEndedOf,
  tellingStartedOf,
  type ToolAccess,
} from '@beonauto/mcp';
import { conversationCallIdKey } from '@beonauto/mcp/policy';
import {
  brainCallerOf,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfBrain,
  type BrainAddress,
  type Lineage,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, type Schema } from 'effect';

export interface Telling {
  readonly brain: BrainAddress;
  readonly server: string;
  readonly tool: string;
  readonly runId: string;
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly lineage: Lineage;
}

export interface TellingParts {
  readonly ledger: StreamWriter;
  readonly tools: Pick<ToolAccess, 'startOf' | 'callOnce'>;
}

const moment = Effect.map(DateTime.now, DateTime.formatIso);

export function told({ ledger, tools }: TellingParts, telling: Telling): Effect.Effect<void> {
  const { brain, server, tool, runId, input, lineage } = telling;
  const callId = randomUUIDv7();
  const stream = `${streamPrefixOfBrain(brain)}${conversationCallStreamOf(callId)}`;
  const by = brainCallerOf(brain).id;
  const call = { ...brain, reference: { server, tool }, input, meta: { [conversationCallIdKey]: callId } };
  return Effect.gen(function* () {
    const started = tellingStartedOf({ callId, runId }, tools.startOf(call), { by, at: yield* moment });
    const { version } = yield* ledger.execute(stream, conversationCallDecider, started, lineage).pipe(Effect.orDie);
    const called = yield* tools.callOnce(call);
    const ended = tellingEndedOf(callId, called, { by, at: yield* moment });
    yield* ledger
      .execute(stream, conversationCallDecider, ended, { ...lineage, causationId: messageIdOf(stream, version) })
      .pipe(Effect.orDie);
  });
}
