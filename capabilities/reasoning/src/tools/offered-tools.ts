import { dynamicTool, jsonSchema, type Tool } from 'ai';
import { Array as Arr, Option, Schema } from 'effect';

import type { ModelTool, ModelTools, ToolReply } from '../model/model-request.ts';

const decodeArguments = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

const decodeReply = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String, isError: Schema.Boolean }));

const notAnObject: ToolReply = {
  text: 'The arguments of this call are not a JSON object, so it was not sent; send an object.',
  isError: true,
};

interface Run {
  readonly toolCallId: string;
  readonly abortSignal?: Readonly<AbortSignal> | undefined;
}

function modelOutputOf({ output }: { readonly output: unknown }) {
  const { text, isError } = decodeReply(output);
  return isError ? { type: 'error-text' as const, value: text } : { type: 'text' as const, value: text };
}

function toolOf(offered: ModelTool, stop: Readonly<AbortSignal>, cancelled: Readonly<AbortSignal>): Tool {
  return dynamicTool({
    description: offered.description,
    inputSchema: jsonSchema(offered.inputSchema),
    execute: (input: unknown, { toolCallId, abortSignal }: Run) => {
      const signal = AbortSignal.any([...Arr.fromNullishOr(abortSignal), stop]);
      return Option.match(decodeArguments(input), {
        onNone: () => Promise.resolve(notAnObject),
        onSome: (args) => offered.call({ callId: toolCallId, input: args }, { signal, cancelled }),
      });
    },
    toModelOutput: modelOutputOf,
  });
}

export function offeredTools(tools: ModelTools, cancelled: Readonly<AbortSignal>): Record<string, Tool> {
  return Object.fromEntries(tools.offered.map((offered) => [offered.name, toolOf(offered, tools.ended, cancelled)]));
}
