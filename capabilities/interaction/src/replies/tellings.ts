import {
  conversationCallDecider,
  conversationCallStreamOf,
  tellingEndedOf,
  tellingStartedOf,
  type DefinitionOfTheTelling,
  type ToolAccess,
} from '@beonauto/mcp';
import { conversationCallIdKey } from '@beonauto/mcp/policy';
import {
  playbookCallerOf,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type Lineage,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, type Schema } from 'effect';

export interface Telling {
  readonly playbook: PlaybookAddress;
  readonly server: string;
  readonly tool: string;
  readonly runId: string;
  readonly definition: DefinitionOfTheTelling;
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly lineage: Lineage;
}

export interface TellingParts {
  readonly ledger: StreamWriter;
  readonly tools: Pick<ToolAccess, 'startOf' | 'callOnce'>;
}

const moment = Effect.map(DateTime.now, DateTime.formatIso);

export function told({ ledger, tools }: TellingParts, telling: Telling): Effect.Effect<void> {
  const { playbook, server, tool, runId, definition, input, lineage } = telling;
  const callId = randomUUIDv7();
  const stream = `${streamPrefixOfPlaybook(playbook)}${conversationCallStreamOf(callId)}`;
  const by = playbookCallerOf(playbook).id;
  const call = { ...playbook, reference: { server, tool }, input, meta: { [conversationCallIdKey]: callId } };
  return Effect.gen(function* () {
    const fields = yield* tools.startOf(call);
    const started = tellingStartedOf({ callId, runId, definition }, fields, { by, at: yield* moment });
    const { version } = yield* ledger.execute(stream, conversationCallDecider, started, lineage).pipe(Effect.orDie);
    const called = yield* tools.callOnce(call);
    const ended = tellingEndedOf({ callId, runId, definition }, called, { by, at: yield* moment });
    yield* ledger
      .execute(stream, conversationCallDecider, ended, { ...lineage, causationId: messageIdOf(stream, version) })
      .pipe(Effect.orDie);
  });
}
