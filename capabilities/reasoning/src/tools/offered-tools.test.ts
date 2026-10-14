import { recordingCallJournal, reportingAccess, serveFakeMcp, toolRun } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModelTools } from '../model/model-request.ts';
import { accessFor, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { anthropicMessage } from '../testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';
import { anthropicToolCall } from '../testing/tool-call-replies.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const largeTool = 'graph__large';

const utf8 = new TextEncoder();

const ToolResultsSchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      content: Schema.Union([
        Schema.String,
        Schema.Array(
          Schema.Union([
            Schema.Struct({ type: Schema.Literal('tool_result'), content: Schema.String }),
            Schema.Struct({ type: Schema.String }),
          ]),
        ),
      ]),
    }),
  ),
});

const AnsweredSchema = Schema.Struct({
  type: Schema.Literal('tool_call_answered'),
  data: Schema.Struct({ shown_bytes: Schema.Int }),
});

const isAnswered = Schema.is(AnsweredSchema);

async function largeAnswers(contextWindow: number) {
  const fake = await serveFakeMcp();
  closing.push(fake.close);
  const { access } = reportingAccess({ graph: { url: fake.url, org: 'acme' } });
  closing.push(access.close);
  const journal = recordingCallJournal();
  const opened = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'graph', tool: 'large' }]));
  closing.push(opened.close);
  const rooms: (number | undefined)[] = [];
  const tools: ModelTools = {
    offered: opened.offered.map((offered) => ({
      ...offered,
      call: (request, signals) => {
        rooms.push(request.room);
        return offered.call(request, signals);
      },
    })),
    callsEnded: opened.callsEnded,
    calledAny: opened.calledAny,
    ended: opened.ended,
    runBoundMs: 600_000,
    mostInputTokens: 2_000_000,
    contextWindow,
  };
  const shownBytes = () =>
    journal
      .facts()
      .filter((fact) => isAnswered(fact))
      .map(({ data }) => data.shown_bytes);
  return { tools, rooms: () => [...rooms], shownBytes };
}

function callingLarge(...kibs: readonly number[]): object {
  const content = kibs.map((kib, index) => ({
    type: 'tool_use',
    id: `toolu_call_${index + 1}`,
    name: largeTool,
    input: { kib },
  }));
  return { ...anthropicToolCall(largeTool, {}), content };
}

async function turnOf(tools: ModelTools, calls: object): Promise<unknown> {
  const recording = recordingFetch((_request, attempt) =>
    jsonResponse(attempt === 1 ? calls : anthropicMessage('Done.')),
  );
  const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });
  await succeeded(access, textRequest('anthropic/claude-sonnet-4-5', { tools }));
  return recording.requests().at(-1)?.body;
}

function toolResultsIn(body: unknown): readonly string[] {
  const { messages } = Schema.decodeUnknownSync(ToolResultsSchema)(body);
  return messages.flatMap(({ content }) =>
    typeof content === 'string' ? [] : content.flatMap((block) => ('content' in block ? [block.content] : [])),
  );
}

function shownInTheNote(text: string): number {
  return Number(/cut to (?<shown>[\d,]+) of its/u.exec(text)?.groups?.['shown']?.replaceAll(',', ''));
}

function ascending(numbers: readonly number[]): readonly number[] {
  return numbers.toSorted((first, second) => first - second);
}

describe('the answers of three calls of one turn', () => {
  it('are each cut to a third of the room of the turn, with the bytes the model read recorded on each call', async () => {
    const alone = await largeAnswers(1_000);
    const together = await largeAnswers(1_000);

    await turnOf(alone.tools, callingLarge(16));
    const read = toolResultsIn(await turnOf(together.tools, callingLarge(16, 17, 18)));
    const third = Math.floor(Number(alone.rooms()[0]) / 3);

    expect(together.rooms()).toEqual([third, third, third]);
    expect(read.map((text) => utf8.encode(text).byteLength <= third)).toEqual([true, true, true]);
    expect(read.map((text) => utf8.encode(text).byteLength > third - utf8.encode('😀').byteLength)).toEqual([
      true,
      true,
      true,
    ]);
    expect(ascending(read.map((text) => shownInTheNote(text)))).toEqual(ascending(together.shownBytes()));
  });
});
