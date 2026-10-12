import { plainTextIn, problemIn } from '@on.auto/api/testing';
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
  properties: Schema.Struct({ playbook: Schema.Struct({ description: Schema.String }) }),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

function playbookArgumentOf(tool: string) {
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

async function askedBeforeAndAfterThePlaybookIsMade() {
  const inOrg = await meetings.onMcp((session) => session.callTool('list_tool_servers', {}));
  await meetings.onMcp((session) => session.callTool('create_playbook', { playbook: 'meetings', name: 'Meetings' }));
  const inPlaybook = await meetings.onPlaybook('meetings', (session) => session.callTool('list_tool_servers', {}));
  return { inOrg, inPlaybook };
}

describe('episode 9: asked for the tool servers on the connection of the whole org, without naming a playbook', () => {
  it('finds the playbook optional, and what the tool answers without it, in the served surfaces', () => {
    const { required = [], properties } = playbookArgumentOf('list_tool_servers');

    expect(required).not.toContain('playbook');
    expect(properties.playbook.description).toContain('without it, every tool server of the org is listed');
    expect(sentenceNaming(descriptionIn(meetings.surfaces, 'list_tool_servers'), 'Without `playbook`')).toBe(
      'Without `playbook` it answers for the whole org, naming the playbooks each server serves.',
    );
  });

  it('is answered, before the playbook is made, with the tool servers of the org and the playbooks each serves, and on the playbook endpoint with those of the playbook', async () => {
    const { inOrg, inPlaybook } = await askedBeforeAndAfterThePlaybookIsMade();

    expect(inOrg.isError).not.toBe(true);
    expect(inOrg.structuredContent).toMatchObject({
      tool_servers: [
        { name: 'notes', playbooks: ['meetings'], because: 'key_refused' },
        { name: 'slack', playbooks: ['meetings'], tools: searchTestable },
      ],
    });
    expect(plainTextIn(inOrg)).toMatch(
      /^The playbooks of this org may use 2 tool servers\. “notes”, for the playbook “meetings”, did not accept the key/u,
    );
    expect(inPlaybook.structuredContent).toMatchObject({
      tool_servers: [
        { name: 'notes', because: 'key_refused' },
        { name: 'slack', tools: searchTestable },
      ],
    });
    expect(fieldsOfEachServer(inPlaybook.structuredContent).map((fields) => fields.includes('playbooks'))).toEqual([
      false,
      false,
    ]);
    expect(plainTextIn(inPlaybook)).toMatch(/^This playbook's functions may use 2 tool servers\. /u);
  });
});

async function askedForAMissingPlaybook() {
  return {
    onMcp: await meetings.onMcp((session) => session.callTool('list_tool_servers', { playbook: 'nowhere' })),
    onItsEndpoint: await meetings.onPlaybook('nowhere', (session) => session.callTool('list_tool_servers', {})),
  };
}

describe('the tool servers of a playbook the org does not have', () => {
  it('are refused on /mcp as on the playbook endpoint, not_found in the same words', async () => {
    const { onMcp, onItsEndpoint } = await askedForAMissingPlaybook();

    expect(problemIn(onMcp)).toMatchObject({
      status: 404,
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
    expect(problemIn(onMcp)).toEqual(problemIn(onItsEndpoint));
    expect(plainTextIn(onMcp)).toBe(plainTextIn(onItsEndpoint));
  });
});
