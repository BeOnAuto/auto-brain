import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import type { Executed, RunContext, PreparedDefinition, Primitive } from '@beonauto/specs';
import { DateTime, Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import type { ModelRequest } from '../model/model-request.ts';
import { makeReasoningFunctionAdapter } from '../primitive/reasoning-function.ts';
import { scriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

const moment = '2026-10-01T09:30:00.000Z';

const anthropicOnly = { providers: ['anthropic'], aliases: [] };

export const execution: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  spec: { name: 'summary', version: 1 },
};

export type Execution = Exit.Exit<Executed, InvalidInput | Unavailable | Conflict>;

export interface ReasoningRun {
  readonly primitive: Primitive;
  readonly requests: () => readonly ModelRequest[];
  readonly prepared: (source: string) => PreparedDefinition;
  readonly executing: (source: string, input?: Schema.Json) => Promise<Execution>;
}

export function reasoningWith(...replies: readonly ScriptedReply[]): ReasoningRun {
  const scripted = scriptedLanguageModel(...replies);
  const primitive = makeReasoningFunctionAdapter({ languageModel: scripted.languageModel, offered: anthropicOnly });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(primitive.prepare(source));
  return {
    primitive,
    requests: scripted.requests,
    prepared,
    executing: (source, input = {}) =>
      Effect.runPromiseExit(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
          Effect.andThen(prepared(source).execute(input, execution)),
          Effect.provide(TestClock.layer()),
        ),
      ),
  };
}
