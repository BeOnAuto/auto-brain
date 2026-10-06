import type { ToolAccess } from '@beonauto/mcp';
import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import type { Executed, ExecutionContext, PreparedSpec, Primitive } from '@beonauto/specs';
import { recordingJournal, type RecordingJournal } from '@beonauto/specs/testing';
import { DateTime, Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import type { ModelRequest } from '../model/model-request.ts';
import { makeInference } from '../primitive/inference-primitive.ts';
import { scriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

const moment = '2026-10-01T09:30:00.000Z';

const anthropicOnly = { providers: ['anthropic'], aliases: [] };

export const execution: ExecutionContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  spec: { name: 'summary', version: 1 },
  journal: recordingJournal(),
};

export type Execution = Exit.Exit<Executed, InvalidInput | Unavailable | Conflict>;

export interface InferenceRun {
  readonly primitive: Primitive;
  readonly requests: () => readonly ModelRequest[];
  readonly prepared: (source: string) => PreparedSpec;
  readonly executing: (source: string, input?: Schema.Json) => Promise<Execution>;
}

export interface ToolRun extends InferenceRun {
  readonly journal: RecordingJournal;
}

function inferenceOf(
  tools: ToolAccess | undefined,
  replies: readonly ScriptedReply[],
  context: ExecutionContext,
): InferenceRun {
  const scripted = scriptedLanguageModel(...replies);
  const primitive = makeInference({
    languageModel: scripted.languageModel,
    offered: anthropicOnly,
    ...(tools === undefined ? {} : { tools }),
  });
  const prepared = (source: string): PreparedSpec => Effect.runSync(primitive.prepare(source));
  return {
    primitive,
    requests: scripted.requests,
    prepared,
    executing: (source, input = {}) =>
      Effect.runPromiseExit(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
          Effect.andThen(prepared(source).execute(input, context)),
          Effect.provide(TestClock.layer()),
        ),
      ),
  };
}

export function inferenceWith(...replies: readonly ScriptedReply[]): InferenceRun {
  return inferenceOf(undefined, replies, execution);
}

export function inferenceWithTools(tools: ToolAccess, ...replies: readonly ScriptedReply[]): ToolRun {
  const journal = recordingJournal();
  return { ...inferenceOf(tools, replies, { ...execution, journal }), journal };
}
