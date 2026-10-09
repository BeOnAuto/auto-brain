import { textOf, type McpSession } from '@beonauto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  sentencesOf,
  servingMeetings,
  type MeetingsServer,
} from '../testing/servers/meetings-server.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

let meetings: MeetingsServer;

const inMeetings = { brain: 'meetings' };

const approvingTheDraft = [
  '---',
  "description: Asks the owner to approve the month's draft",
  'channel: team-chat',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [month, owner]',
  '    properties: { month: { type: string }, owner: { type: string } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [decision]',
  '    properties:',
  '      decision: { type: string, enum: [approve, revise, skip] }',
  '      note: { type: string }',
  '---',
  'Here is the draft for {{ input.month }}: approve, revise or skip?',
].join('\n');

const draftingEachMonth = workflowSource(
  'monthly-draft',
  [
    'input:',
    '  schema:',
    '    document: { type: object, required: [month, owner] }',
    'do:',
    '  - approval:',
    '      call: execute_spec',
    "      with: { primitive: interaction, name: approve-draft, input: '${ . }' }",
    '',
  ].join('\n'),
);

beforeAll(async () => {
  meetings = await servingMeetings([]);
  await meetings.onMcp(async (session) => {
    await session.callTool('create_brain', { ...inMeetings, name: 'Meetings' });
    await session.callTool('create_spec', {
      ...inMeetings,
      primitive: 'interaction',
      name: 'approve-draft',
      source: approvingTheDraft,
    });
    await session.callTool('create_spec', {
      ...inMeetings,
      primitive: 'orchestration',
      name: 'monthly-draft',
      source: draftingEachMonth,
    });
  });
});

afterAll(async () => {
  await meetings.stop();
});

const OpenRequestsSchema = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      execution_id: Schema.String,
      channel: Schema.String,
      message: Schema.String,
      standing: Schema.String,
      answer_schema: Schema.NullOr(Schema.JsonObject),
    }),
  ),
});

const draftAnswerSchema = {
  type: 'object',
  required: ['decision'],
  properties: { decision: { type: 'string', enum: ['approve', 'revise', 'skip'] }, note: { type: 'string' } },
};

type OpenRequest = (typeof OpenRequestsSchema.Type)['interactions'][number];

async function openRequestsIn(session: McpSession): Promise<readonly OpenRequest[]> {
  const listed = await session.callTool('list_interactions', inMeetings);
  return Schema.decodeUnknownSync(OpenRequestsSchema)(listed.structuredContent).interactions;
}

function deliveredRequestsIn(session: McpSession, count: number): Promise<readonly OpenRequest[]> {
  return vi.waitFor(
    async () => {
      const open = await openRequestsIn(session);
      expect(open.filter(({ standing }) => standing === 'delivered')).toHaveLength(count);
      return open;
    },
    { timeout: workflowTestTimeoutMs - 10_000, interval: 50 },
  );
}

function endedIn(session: McpSession, executionId: string): Promise<unknown> {
  return vi.waitFor(
    async () => {
      const read = await session.callTool('get_execution', { ...inMeetings, execution_id: executionId });
      expect(read.structuredContent).not.toMatchObject({ status: 'started' });
      return read.structuredContent;
    },
    { timeout: workflowTestTimeoutMs - 10_000, interval: 50 },
  );
}

function draftFor(session: McpSession, month: string): Promise<string> {
  return session
    .callTool('execute_spec', {
      ...inMeetings,
      primitive: 'orchestration',
      name: 'monthly-draft',
      input: { month, owner: 'ada' },
    })
    .then(({ structuredContent }) => executionIdIn(structuredContent));
}

async function approvedThenNextMonth(session: McpSession) {
  const september = await draftFor(session, 'September');
  const [asked] = await deliveredRequestsIn(session, 1);
  const answered = await session.callTool('answer_interaction', {
    ...inMeetings,
    execution_id: String(asked?.execution_id),
    answer: { decision: 'approve' },
  });
  const ended = await endedIn(session, september);
  const openOnceAnswered = await openRequestsIn(session);
  await draftFor(session, 'October');
  return { asked, answered, ended, openOnceAnswered, openForOctober: await deliveredRequestsIn(session, 1) };
}

describe(
  'episode 7: the person approves, in the chat, a draft a workflow sent through a channel',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('finds in the instructions, answer_interaction and the guide that the answer goes to the waiting request, and nothing that says to wait in a loop', async () => {
      const { instructions } = meetings.surfaces;
      const guide = await meetings.onMcp((session) => session.callTool('get_guide', { guide: 'interaction-function' }));

      expect(sentenceNaming(instructions, 'answer_interaction')).toBe(
        "When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, in the shape its function's answer takes, and start no new run for it.",
      );
      expect(sentenceNaming(instructions, 'get_execution')).toBe(
        'A run of an interaction function or a workflow answers started; get_execution shows whether it ended or still waits.',
      );
      expect(instructions).not.toMatch(/\bpoll|\buntil (?:it ends|its status changes)/iu);
      expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain(
        'Use it when the person approves, rejects, revises or otherwise answers a request list_interactions shows, wherever it reached them; a new run asks again and answers nothing,',
      );
      expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain('such as {"decision": "approve"}.');
      expect(textOf(guide)).toContain('it is `{ "decision": "approve" }`.');
      expect(textOf(guide)).toContain('Running the function or its workflow again answers nothing:');
    });

    it('answers the request the person approved, which ends the run that waited, and starts a new run only for the next month', async () => {
      const outcome = await meetings.onMcp(approvedThenNextMonth);

      expect([outcome.asked?.channel, outcome.asked?.message, outcome.asked?.answer_schema]).toEqual([
        'team-chat',
        'Here is the draft for September: approve, revise or skip?',
        draftAnswerSchema,
      ]);
      expect(outcome.answered.structuredContent).toMatchObject({
        status: 'succeeded',
        output: { decision: 'approve' },
      });
      expect(outcome.ended).toMatchObject({ status: 'succeeded', output: { decision: 'approve' } });
      expect(outcome.openOnceAnswered).toEqual([]);
      expect(outcome.openForOctober.map(({ message }) => message)).toEqual([
        'Here is the draft for October: approve, revise or skip?',
      ]);
    });
  },
);

describe('the shape of the answer an open request takes, as the agent reads it', () => {
  it('is on each listed request, as the description of list_interactions says within the bounds the server holds texts to', () => {
    const description = descriptionIn(meetings.surfaces, 'list_interactions');

    expect(sentenceNaming(description, 'answer_schema')).toBe(
      'Each carries its `answer_schema`, the shape answer_interaction checks an answer against, as recorded when it was asked, which get_spec may no longer show; null for a notification.',
    );
    expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain(
      "`answer` takes the shape of the request's answer_schema, which list_interactions shows,",
    );
    expect([description.length < 800, sentencesOf(description).length]).toEqual([true, 5]);
  });
});
