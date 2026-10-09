import { Buffer } from 'node:buffer';

import { mostGuideBytes } from '@beonauto/api';
import { plainTextIn, textOf, type McpSession } from '@beonauto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sentenceNaming, servingMeetings, type MeetingsServer } from '../testing/servers/meetings-server.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

let meetings: MeetingsServer;

const namingTheMessage: unknown = expect.stringContaining('"ts":"1699.000001"');

const listingTheMessages: unknown = expect.stringContaining('"messages":[');

const inMeetings = { brain: 'meetings' };

const approvingInTheChat = [
  '---',
  'description: Send the draft to its owner in the chat and take their approval',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#drafts'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
  'replies:',
  "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, draft]',
  '    properties: { owner: { type: string }, draft: { type: string, maxLength: 4000 } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
  '---',
  'Here is the draft:',
  '',
  '{{ input.draft }}',
  '',
  'Reply **approve** or **reject**, with a note if you reject.',
].join('\n');

beforeAll(async () => {
  meetings = await servingMeetings([], { chat: true });
  await meetings.onMcp((session) => session.callTool('create_brain', { ...inMeetings, name: 'Meetings' }));
});

afterAll(async () => {
  await meetings.stop();
});

async function askedToSendADraft(session: McpSession) {
  const guide = textOf(await session.callTool('get_guide', { guide: 'interaction-function' }));
  const sent = await session.callTool('test_tool_call', {
    ...inMeetings,
    server: 'chat',
    tool: 'post_message',
    arguments: { channel: '#drafts', text: 'A draft to look at' },
  });
  const read = await session.callTool('test_tool_call', {
    ...inMeetings,
    server: 'chat',
    tool: 'thread_replies',
    arguments: { channel: '#drafts', ts: '1699.000001' },
  });
  const saved = await session.callTool('create_definition', {
    ...inMeetings,
    type: 'interaction',
    name: 'approve-draft',
    source: approvingInTheChat,
  });
  const reasoning = await session.callTool('list_definitions', { ...inMeetings, type: 'reasoning' });
  return { guide, sent, read, saved, reasoning };
}

async function askedWhereNoToolServerIs(session: McpSession) {
  const briefs = { brain: 'briefs' };
  await session.callTool('create_brain', { ...briefs, name: 'Briefs' });
  await session.callTool('create_definition', {
    ...briefs,
    type: 'interaction',
    name: 'approve-draft',
    source: approvingInTheChat,
  });
  return session.callTool('run_definition', {
    ...briefs,
    type: 'interaction',
    name: 'approve-draft',
    input: { owner: 'ada', draft: 'The September newsletter' },
  });
}

describe(
  'episode 9: asked to send the person a draft in the chat and take their approval',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('reads the interaction sentence, tests the tool that sends and the tool that reads, and saves one interaction function', async () => {
      const seen = await meetings.onMcp(askedToSendADraft);

      expect(sentenceNaming(meetings.surfaces.instructions, 'An interaction function')).toBe(
        'An interaction function asks a person or a system and takes the answer later.',
      );
      expect([seen.sent.structuredContent, seen.read.structuredContent]).toMatchObject([
        { outcome: 'result', text: namingTheMessage },
        { outcome: 'result', text: listingTheMessages },
      ]);
      expect(seen.guide).toMatch(/^## Sending through a tool\n[\s\S]*^### Attempts\n[\s\S]*^## Fields$/mu);
      expect(Buffer.byteLength(seen.guide)).toBeLessThan(mostGuideBytes);
      expect(seen.saved.isError).not.toBe(true);
      expect(seen.reasoning.structuredContent).toEqual({ definitions: [] });
    });

    it('is told, on a brain no tool server serves, what whoever runs the server sets up', async () => {
      const refused = await meetings.onMcp(askedWhereNoToolServerIs);

      expect(plainTextIn(refused)).toBe(
        'Could not run the interaction function “approve-draft”: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain. Nothing was changed. This can be put right on your side: whoever runs the server decides which tool servers and tools this brain may use, which list_tool_servers shows, so once it names only those, it can be tried again.',
      );
    });
  },
);
