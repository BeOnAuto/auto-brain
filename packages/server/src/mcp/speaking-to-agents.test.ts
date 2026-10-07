import { internalTermsIn, plainTextIn, type McpSession } from '@beonauto/api/testing';
import { answers, jsonResult } from '@beonauto/inference/testing';
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

const mappingOfTheWireNames = /The tools call a definition a spec[^.]*\./u;

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
      'A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists.',
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
  '    - type: execution_succeeded',
  '      subject: inference/post-notes',
  'view:',
  '  initial: []',
  '---',
  '. + [$event.data.output.posted]',
].join('\n');

const inPosts = { brain: 'posts' };

function standingOf(session: McpSession): Promise<unknown> {
  return vi.waitFor(
    async () => {
      const read = await session.callTool('get_spec', { ...inPosts, primitive: 'recollection', name: 'posted' });
      expect(read.structuredContent).toMatchObject({ standing: { state: 'live', folded: 1 } });
      return read.structuredContent;
    },
    { timeout: recallTestTimeoutMs - 10_000, interval: 50 },
  );
}

async function rememberedOverMcp(session: McpSession) {
  await session.callTool('create_brain', { ...inPosts, name: 'Posts' });
  await session.callTool('create_spec', {
    ...inPosts,
    primitive: 'inference',
    name: 'post-notes',
    source: postingWhatItPosted,
  });
  await session.callTool('execute_spec', {
    ...inPosts,
    primitive: 'inference',
    name: 'post-notes',
    input: { meeting: 'the standup' },
  });
  await session.callTool('create_spec', {
    ...inPosts,
    primitive: 'recollection',
    name: 'posted',
    source: rememberingWhatWasPosted,
  });
  await standingOf(session);
  return session.callTool('execute_spec', { ...inPosts, primitive: 'recollection', name: 'posted' });
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
  it('finds only the words of the terminology in the instructions, but the sentence that maps the wire names, and in the words of the results', async () => {
    const words = await onMcp(async (session) => {
      await session.callTool('create_brain', { brain: 'standups', name: 'Standups' });
      const results = [
        await session.callTool('create_spec', {
          brain: 'standups',
          primitive: 'inference',
          name: 'post-notes',
          source: posting,
        }),
        await session.callTool('list_specs', { brain: 'standups', primitive: 'inference' }),
        await session.callTool('list_executions', { brain: 'standups' }),
      ];
      return results.map((result) => plainTextIn(result));
    });

    expect(internalTermsIn(surfaces.instructions.replace(mappingOfTheWireNames, ''))).toEqual([]);
    expect(words.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });
});

describe('episode 6: a tool server that refuses its key, and a brain with no tool server', () => {
  it('says the key was not accepted and that trying again will not help until it is checked, and what to do in the words of an empty listing', async () => {
    const outcome = await onMcp(async (session) => {
      await session.callTool('create_spec', {
        brain: 'meetings',
        primitive: 'inference',
        name: 'post-notes',
        source: posting,
      });
      return {
        refused: await session.callTool('execute_spec', {
          brain: 'meetings',
          primitive: 'inference',
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
