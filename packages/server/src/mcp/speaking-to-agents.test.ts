import { internalTermsIn, plainTextIn, type McpSession } from '@beonauto/api/testing';
import { answers, jsonResult } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  sentencesOf,
  servingMeetings,
  type MeetingsServer,
  type Surfaces,
} from '../testing/servers/meetings-server.ts';
import { recallTestTimeoutMs } from '../testing/servers/recall-server.ts';

let meetings: MeetingsServer;

let surfaces: Surfaces;

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return meetings.onMcp(use);
}

beforeAll(async () => {
  meetings = await servingMeetings([answers(jsonResult({ posted: 'The notes of the standup, to the team channel' }))]);
  ({ surfaces } = meetings);
});

afterAll(async () => {
  await meetings.stop();
});

function descriptionOf(tool: string): string {
  return descriptionIn(surfaces, tool);
}

const PromptSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.optionalKey(Schema.String) }) })),
});

const meetingsBrain = { brain: 'meetings', name: 'Meetings', description: "Keeps the team's meeting notes" };

const posting = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Posts the notes of a meeting to the team',
  'tools: [notes/search]',
  '---',
  'Post the notes of {{ input.meeting }}.',
].join('\n');

describe('episode 1: asked "what is brains?"', () => {
  it('is answered by the first three sentences of the instructions, without any tool or rule', () => {
    const answer = sentencesOf(surfaces.instructions).slice(0, 3).join(' ');

    expect(answer).toBe(
      'A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model.',
    );
    expect(internalTermsIn(answer)).toEqual([]);
    expect(answer).not.toMatch(/[a-z]+_[a-z_]+|\bid\b/u);
  });
});

describe('episode 2: asked to create a brain for meetings', () => {
  it('finds no rule of an id beyond the argument, and words that say what the brain is for and what comes next', async () => {
    const created = await onMcp((session) => session.callTool('create_brain', meetingsBrain));

    expect(sentencesOf(descriptionOf('create_brain')).filter((sentence) => /\bid\b/u.test(sentence))).toEqual([
      'Use it when the person wants a new brain; list_brains shows the brains that exist, and an id that is taken or retired is refused.',
      "`brain` is the id every tool inside the brain takes, `name` is what people call it, and `description` says what the brain is for, in the person's words.",
    ]);
    expect(descriptionOf('create_brain')).not.toMatch(/lowercase|never changes|immutable|reused/u);
    expect(plainTextIn(created)).toBe(
      "Created the brain “Meetings”. What it is for: Keeps the team's meeting notes. Its functions and workflows come next.",
    );
  });
});

describe('episode 3: asked to use Slack', () => {
  it('finds list_tool_servers in the instructions, and its answer names each tool server', async () => {
    const listed = await onMcp((session) => session.callTool('list_tool_servers', { brain: 'meetings' }));

    expect(sentenceNaming(surfaces.instructions, 'list_tool_servers')).toBe(
      'A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists; test_tool_call shows what a tool answers.',
    );
    expect(plainTextIn(listed)).toMatch(/^This brain's functions may use 2 tool servers\. /u);
    expect(plainTextIn(listed)).toContain('“slack” offers');
    expect(plainTextIn(listed)).toContain(
      '“notes” did not accept the key this server gives it, so whoever runs this server can check that key.',
    );
  });
});

const postingWhatItPosted = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Posts the notes of a meeting to the team, and answers what it posted',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {posted: {type: string}}, required: [posted]}',
  '---',
  'Post the notes of {{ input.meeting }}, and answer what you posted.',
].join('\n');

const rememberingWhatWasPosted = [
  '---',
  'description: What post-notes answered it posted, oldest first',
  'language: jq',
  'source:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: reasoning/post-notes',
  'view:',
  '  initial: []',
  '---',
  '. + [$event.data.output.posted]',
].join('\n');

const inPosts = { brain: 'posts' };

function standingOf(session: McpSession): Promise<unknown> {
  return vi.waitFor(
    async () => {
      const read = await session.callTool('get_definition', { ...inPosts, type: 'recall', name: 'posted' });
      expect(read.structuredContent).toMatchObject({ standing: { state: 'live', folded: 1 } });
      return read.structuredContent;
    },
    { timeout: recallTestTimeoutMs - 10_000, interval: 50 },
  );
}

async function rememberedOverMcp(session: McpSession) {
  await session.callTool('create_brain', { ...inPosts, name: 'Posts' });
  await session.callTool('create_definition', {
    ...inPosts,
    type: 'reasoning',
    name: 'post-notes',
    source: postingWhatItPosted,
  });
  await session.callTool('run_definition', {
    ...inPosts,
    type: 'reasoning',
    name: 'post-notes',
    input: { meeting: 'the standup' },
  });
  await session.callTool('create_definition', {
    ...inPosts,
    type: 'recall',
    name: 'posted',
    source: rememberingWhatWasPosted,
  });
  await standingOf(session);
  return session.callTool('run_definition', { ...inPosts, type: 'recall', name: 'posted' });
}

describe('episode 4: asked to make the brain remember what it posted today', { timeout: recallTestTimeoutMs }, () => {
  it('finds what a recall function folds and never folds, and a recipe that says the function must answer what it posted', async () => {
    const prompt = Schema.decodeUnknownSync(PromptSchema)(
      await onMcp((session) => session.getPrompt('remember', { what: 'what it posted today' })),
    );

    expect(sentenceNaming(surfaces.instructions, 'A recall function')).toContain(
      "never a run's input or its tool calls, so nothing has to write into it.",
    );
    expect(String(prompt.messages[0]?.content.text)).toContain(
      'a function whose job is to post must answer what it posted.',
    );
  });

  it('saves the recall function the recipe describes over the runs of the function that posts, which answers what was posted', async () => {
    const recalled = await onMcp(rememberedOverMcp);

    expect(recalled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: ['The notes of the standup, to the team channel'],
    });
  });
});

describe('episode 5: quoting the tools to a person who does not code', () => {
  it('finds only the words of the terminology in the instructions and in the words of the results', async () => {
    const words = await onMcp(async (session) => {
      await session.callTool('create_brain', { brain: 'standups', name: 'Standups' });
      const results = [
        await session.callTool('create_definition', {
          brain: 'standups',
          type: 'reasoning',
          name: 'post-notes',
          source: posting,
        }),
        await session.callTool('list_definitions', { brain: 'standups', type: 'reasoning' }),
        await session.callTool('list_runs', { brain: 'standups' }),
      ];
      return results.map((result) => plainTextIn(result));
    });

    expect(internalTermsIn(surfaces.instructions)).toEqual([]);
    expect(words.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });
});

describe('episode 6: a tool server that refuses its key, and a brain with no tool server', () => {
  it('says the key was not accepted and that trying again will not help until it is checked, and what to do in the words of an empty listing', async () => {
    const outcome = await onMcp(async (session) => {
      await session.callTool('create_definition', {
        brain: 'meetings',
        type: 'reasoning',
        name: 'post-notes',
        source: posting,
      });
      return {
        refused: await session.callTool('run_definition', {
          brain: 'meetings',
          type: 'reasoning',
          name: 'post-notes',
          input: { meeting: 'the standup' },
        }),
        empty: await session.callTool('list_tool_servers', { brain: 'standups' }),
      };
    });

    expect(plainTextIn(outcome.refused)).toBe(
      'Could not run the reasoning function “post-notes”: a tool server it needs could not be used, because the tool server did not accept the key this server gives it. Nothing was changed. Trying again will not help until whoever runs the server checks the key it gives that tool server.',
    );
    expect(plainTextIn(outcome.empty)).toBe(
      'Whoever runs this server has set up no tool server for this brain, so its functions can call no tools until they set one up; the give-tools guide says what they need.',
    );
  });
});

const ChannelsSchema = Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })));

const TestedSchema = Schema.Struct({ structuredContent: Schema.Struct({ text: Schema.String }) });

function channelsIn(tested: unknown) {
  return Schema.decodeUnknownSync(ChannelsSchema)(
    Schema.decodeUnknownSync(TestedSchema)(tested).structuredContent.text,
  );
}

const searchTestable: unknown = expect.arrayContaining([expect.objectContaining({ name: 'search', testable: true })]);

async function lookedAtOverMcp(session: McpSession) {
  const before = await session.callTool('list_definitions', { brain: 'meetings', type: 'reasoning' });
  const listed = await session.callTool('list_tool_servers', { brain: 'meetings', server: 'slack' });
  const tested = await session.callTool('test_tool_call', {
    brain: 'meetings',
    server: 'slack',
    tool: 'search',
    arguments: { query: 'standups' },
  });
  const after = await session.callTool('list_definitions', { brain: 'meetings', type: 'reasoning' });
  return { before, listed, tested, after };
}

describe('episode 8: asked what a gateway-style tool server offers, and then to post to #random', () => {
  it('finds the clause in the instructions and testable in the listing, tests the search tool, and makes no function to look', async () => {
    const seen = await onMcp(lookedAtOverMcp);

    expect(sentenceNaming(surfaces.instructions, 'test_tool_call')).toBe(
      'A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists; test_tool_call shows what a tool answers.',
    );
    expect(seen.listed.structuredContent).toMatchObject({ tool_servers: [{ name: 'slack', tools: searchTestable }] });
    expect(plainTextIn(seen.listed)).toMatch(/; search, .* can be tested\.$/u);
    expect(seen.tested.structuredContent).toMatchObject({ outcome: 'result', text: 'Found 2 rows for standups.' });
    expect(seen.after.structuredContent).toEqual(seen.before.structuredContent);
    expect(descriptionOf('test_tool_call')).toContain('in place of a function made to look');
  });

  it('tests the tool that lists the channels and takes the id of #random from its answer, as the give-tools recipe says', async () => {
    const { prompt, tested } = await onMcp(async (session) => ({
      prompt: Schema.decodeUnknownSync(PromptSchema)(await session.getPrompt('give-tools', { server: 'slack' })),
      tested: await session.callTool('test_tool_call', { brain: 'meetings', server: 'slack', tool: 'list_channels' }),
    }));

    expect(String(prompt.messages[0]?.content.text)).toContain(
      "When a prompt needs an id, such as a channel's, test the tool that lists them and take the id from its answer, confirming the choice with the person.",
    );
    expect(channelsIn(tested).find(({ name }) => name === 'random')?.id).toBe('C08RNDM4Q2');
  });
});
