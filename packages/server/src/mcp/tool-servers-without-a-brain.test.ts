import { plainTextIn, problemIn } from '@beonauto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  servingMeetings,
  type MeetingsServer,
} from '../testing/servers/meetings-server.ts';

let meetings: MeetingsServer;

beforeAll(async () => {
  meetings = await servingMeetings([]);
});

afterAll(async () => {
  await meetings.stop();
});

const ArgumentsSchema = Schema.Struct({
  properties: Schema.Struct({ brain: Schema.Struct({ description: Schema.String }) }),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

function brainArgumentOf(tool: string) {
  return Schema.decodeUnknownSync(ArgumentsSchema)(
    meetings.surfaces.tools.find(({ name }) => name === tool)?.inputSchema,
  );
}

const ListedServersSchema = Schema.Struct({
  tool_servers: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});

function fieldsOfEachServer(listed: unknown): readonly (readonly string[])[] {
  return Schema.decodeUnknownSync(ListedServersSchema)(listed).tool_servers.map((server) => Object.keys(server));
}

const searchTestable: unknown = expect.arrayContaining([expect.objectContaining({ name: 'search', testable: true })]);

async function askedBeforeAndAfterTheBrainIsMade() {
  const inOrg = await meetings.onMcp((session) => session.callTool('list_tool_servers', {}));
  await meetings.onMcp((session) => session.callTool('create_brain', { brain: 'meetings', name: 'Meetings' }));
  const inBrain = await meetings.onBrain('meetings', (session) => session.callTool('list_tool_servers', {}));
  return { inOrg, inBrain };
}

describe('episode 9: asked for the tool servers on the connection of the whole org, without naming a brain', () => {
  it('finds the brain optional, and what the tool answers without it, in the served surfaces', () => {
    const { required = [], properties } = brainArgumentOf('list_tool_servers');

    expect(required).not.toContain('brain');
    expect(properties.brain.description).toContain('without it, every tool server of the org is listed');
    expect(sentenceNaming(descriptionIn(meetings.surfaces, 'list_tool_servers'), 'Without `brain`')).toBe(
      'Without `brain` it answers for the whole org, naming the brains each server serves.',
    );
  });

  it('is answered, before the brain is made, with the tool servers of the org and the brains each serves, and on the brain endpoint with those of the brain', async () => {
    const { inOrg, inBrain } = await askedBeforeAndAfterTheBrainIsMade();

    expect(inOrg.isError).not.toBe(true);
    expect(inOrg.structuredContent).toMatchObject({
      tool_servers: [
        { name: 'notes', brains: ['meetings'], because: 'key_refused' },
        { name: 'slack', brains: ['meetings'], tools: searchTestable },
      ],
    });
    expect(plainTextIn(inOrg)).toMatch(
      /^The brains of this org may use 2 tool servers\. “notes”, for the brain “meetings”, did not accept the key/u,
    );
    expect(inBrain.structuredContent).toMatchObject({
      tool_servers: [
        { name: 'notes', because: 'key_refused' },
        { name: 'slack', tools: searchTestable },
      ],
    });
    expect(fieldsOfEachServer(inBrain.structuredContent).map((fields) => fields.includes('brains'))).toEqual([
      false,
      false,
    ]);
    expect(plainTextIn(inBrain)).toMatch(/^This brain's functions may use 2 tool servers\. /u);
  });
});

async function askedForAMissingBrain() {
  return {
    onMcp: await meetings.onMcp((session) => session.callTool('list_tool_servers', { brain: 'nowhere' })),
    onItsEndpoint: await meetings.onBrain('nowhere', (session) => session.callTool('list_tool_servers', {})),
  };
}

describe('the tool servers of a brain the org does not have', () => {
  it('are refused on /mcp as on the brain endpoint, not_found in the same words', async () => {
    const { onMcp, onItsEndpoint } = await askedForAMissingBrain();

    expect(problemIn(onMcp)).toMatchObject({
      status: 404,
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
    expect(problemIn(onMcp)).toEqual(problemIn(onItsEndpoint));
    expect(plainTextIn(onMcp)).toBe(plainTextIn(onItsEndpoint));
  });
});
