import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@beonauto/api/testing';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import type { ScriptedReply } from '@beonauto/reasoning/testing';

import { servingReasoning } from './reasoning-server.ts';

const slackKey = 'slack-api-key-7c2e9b14';

const chatKey = 'chat-api-key-3e8b51d0';

export interface Surfaces {
  readonly instructions: string;
  readonly tools: readonly ListedTool[];
}

export interface MeetingsServer {
  readonly surfaces: Surfaces;
  readonly onMcp: <T>(use: (session: McpSession) => Promise<T>) => Promise<T>;
  readonly onBrain: <T>(brain: string, use: (session: McpSession) => Promise<T>) => Promise<T>;
  readonly chat: FakeMcpServer | undefined;
  readonly stop: () => Promise<void>;
}

export interface MeetingsOptions {
  readonly chat?: boolean;
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

async function chatServing(options: MeetingsOptions) {
  if (options.chat !== true) {
    return { chat: undefined, servers: {} };
  }
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true });
  const entry = {
    url: chat.url,
    headers: { Authorization: 'Bearer ${CHAT_KEY}' },
    org: 'local',
    brains: ['meetings'],
    testable: ['post_message'],
  };
  return { chat, servers: { chat: entry } };
}

export async function servingMeetings(
  replies: readonly ScriptedReply[],
  options: MeetingsOptions = {},
): Promise<MeetingsServer> {
  const slack = await serveFakeMcp({ bearer: slackKey });
  const { chat, servers } = await chatServing(options);
  const server = await servingReasoning(replies, {
    LOCAL_MODE: 'true',
    SLACK_KEY: slackKey,
    CHAT_KEY: chatKey,
    NOTES_KEY: 'a-key-the-server-refuses',
    MCP_SERVERS: JSON.stringify({
      slack: { url: slack.url, headers: { Authorization: 'Bearer ${SLACK_KEY}' }, org: 'local', brains: ['meetings'] },
      notes: { url: slack.url, headers: { Authorization: 'Bearer ${NOTES_KEY}' }, org: 'local', brains: ['meetings'] },
      ...servers,
    }),
  });
  const onMcp = <T>(use: (session: McpSession) => Promise<T>): Promise<T> =>
    withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
  const surfaces = await onMcp(async (session) => ({
    instructions: String(session.instructions),
    tools: listedTools(await session.listTools()),
  }));
  return {
    surfaces,
    chat,
    onMcp,
    onBrain: (brain, use) =>
      withMcpSession('current revision', { url: `${server.origin}/orgs/local/brains/${brain}/mcp`, headers: {} }, use),
    stop: async () => {
      await server.stop();
      await slack.close();
      await chat?.close();
    },
  };
}
