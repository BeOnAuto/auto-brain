import type { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import type { Executed, ExecutionContext, PreparedSpec, Primitive } from '@beonauto/specs';
import { DateTime, Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import type { ModelRequest } from '../model/model-request.ts';
import { makeInference } from '../primitive/inference-primitive.ts';
import { scriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

const moment = '2026-10-01T09:30:00.000Z';

export const execution: ExecutionContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  spec: { name: 'summary', version: 1 },
};

export type Execution = Exit.Exit<Executed, InvalidInput | Unavailable | Conflict>;

export interface InferenceRun {
  readonly primitive: Primitive;
  readonly requests: () => readonly ModelRequest[];
  readonly prepared: (source: string) => PreparedSpec;
  readonly executing: (source: string, input?: Schema.Json) => Promise<Execution>;
}

export function inferenceWith(...replies: readonly ScriptedReply[]): InferenceRun {
  const scripted = scriptedLanguageModel(...replies);
  const primitive = makeInference({ languageModel: scripted.languageModel });
  const prepared = (source: string): PreparedSpec => Effect.runSync(primitive.prepare(source));
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
