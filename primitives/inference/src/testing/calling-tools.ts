import { Effect, Option } from 'effect';

import type { ModelRequest, ModelTool, ToolReply } from '../model/model-request.ts';
import type { ScriptedReply } from './scripted-language-model.ts';

export type ScriptedCall = readonly [string, Readonly<Record<string, unknown>>];

function toolNamed({ tools }: ModelRequest, name: string): ModelTool {
  return Option.getOrThrow(Option.fromNullishOr(tools?.offered.find((offered) => offered.name === name)));
}

function calledInTurn(request: ModelRequest, calls: readonly ScriptedCall[]): Promise<readonly ToolReply[]> {
  const signal = new AbortController().signal;
  return calls.reduce<Promise<readonly ToolReply[]>>(
    async (done, [name, input], index) => [
      ...(await done),
      await toolNamed(request, name).call({ callId: `call-${index + 1}`, input }, { signal, cancelled: signal }),
    ],
    Promise.resolve([]),
  );
}

export function callingTools(calls: readonly ScriptedCall[], then: ScriptedReply): ScriptedReply {
  return (request) => Effect.promise(() => calledInTurn(request, calls)).pipe(Effect.andThen(then(request)));
}
