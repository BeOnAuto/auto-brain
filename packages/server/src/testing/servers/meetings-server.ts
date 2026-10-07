import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@beonauto/api/testing';
import type { ScriptedReply } from '@beonauto/inference/testing';
import { serveFakeMcp } from '@beonauto/mcp/testing';

import { servingReasoning } from './reasoning-server.ts';

const slackKey = 'slack-api-key-7c2e9b14';

export interface Surfaces {
  readonly instructions: string;
  readonly tools: readonly ListedTool[];
}

export interface MeetingsServer {
  readonly surfaces: Surfaces;
  readonly onMcp: <T>(use: (session: McpSession) => Promise<T>) => Promise<T>;
  readonly stop: () => Promise<void>;
}

export function sentencesOf(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`])/u);
}

export function sentenceNaming(text: string, ...words: readonly string[]): string {
  return String(sentencesOf(text).find((sentence) => words.every((word) => sentence.includes(word))));
}

export function descriptionIn({ tools }: Surfaces, tool: string): string {
  return String(tools.find(({ name }) => name === tool)?.description);
}

const teamChat = {
  type: 'mcp',
  server: 'slack',
  tool: 'echo',
  to: '^[a-z]+$',
  with: { channel: '#{{ to }}', text: '{{ message }}' },
  org: 'local',
  brains: ['meetings'],
};

export async function servingMeetings(replies: readonly ScriptedReply[]): Promise<MeetingsServer> {
  const slack = await serveFakeMcp({ bearer: slackKey });
  const server = await servingReasoning(replies, {
    LOCAL_MODE: 'true',
    SLACK_KEY: slackKey,
    NOTES_KEY: 'a-key-the-server-refuses',
    MCP_SERVERS: JSON.stringify({
      slack: { url: slack.url, headers: { Authorization: 'Bearer ${SLACK_KEY}' }, org: 'local', brains: ['meetings'] },
      notes: { url: slack.url, headers: { Authorization: 'Bearer ${NOTES_KEY}' }, org: 'local', brains: ['meetings'] },
    }),
    ALLOWED_TOOLS: JSON.stringify(['slack/*', 'notes/*']),
    CHANNELS: JSON.stringify({ 'team-chat': teamChat }),
  });
  const onMcp = <T>(use: (session: McpSession) => Promise<T>): Promise<T> =>
    withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
  const surfaces = await onMcp(async (session) => ({
    instructions: String(session.instructions),
    tools: listedTools(await session.listTools()),
  }));
  return {
    surfaces,
    onMcp,
    stop: async () => {
      await server.stop();
      await slack.close();
    },
  };
}
