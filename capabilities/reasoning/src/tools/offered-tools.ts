import { dynamicTool, jsonSchema, type Tool } from 'ai';
import { Array as Arr, Option, Schema } from 'effect';

import type { ModelTool, ModelTools, ToolReply } from '../model/model-request.ts';
import type { TurnMeter } from './turn-meter.ts';

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

interface Stops {
  readonly stop: Readonly<AbortSignal>;
  readonly cancelled: Readonly<AbortSignal>;
}

function roomOfAnswer(room: number | undefined): { readonly room?: number } {
  return room === undefined ? {} : { room };
}

async function measuredReply(turns: TurnMeter, replying: Promise<ToolReply>): Promise<ToolReply> {
  const reply = await replying;
  turns.answered(reply.text);
  return reply;
}

function toolOf(offered: ModelTool, { stop, cancelled }: Stops, turns: TurnMeter): Tool {
  return dynamicTool({
    description: offered.description,
    inputSchema: jsonSchema(offered.inputSchema),
    execute: (input: unknown, { toolCallId, abortSignal }: Run) => {
      const signal = AbortSignal.any([...Arr.fromNullishOr(abortSignal), stop]);
      const request = { callId: toolCallId, ...roomOfAnswer(turns.roomOfEachAnswer()) };
      return Option.match(decodeArguments(input), {
        onNone: () => measuredReply(turns, Promise.resolve(notAnObject)),
        onSome: (args) => measuredReply(turns, offered.call({ ...request, input: args }, { signal, cancelled })),
      });
    },
    toModelOutput: modelOutputOf,
  });
}

export function offeredTools(
  tools: ModelTools,
  cancelled: Readonly<AbortSignal>,
  turns: TurnMeter,
): Record<string, Tool> {
  const stops = { stop: tools.ended, cancelled };
  return Object.fromEntries(tools.offered.map((offered) => [offered.name, toolOf(offered, stops, turns)]));
}
