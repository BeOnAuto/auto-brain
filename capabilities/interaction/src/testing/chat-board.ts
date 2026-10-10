import type { AnsweredOnce, CallAnswer, OneCall } from '@beonauto/mcp';

interface Answering {
  readonly detail: string;
  readonly retryAfterMs: number | null;
}

export type BoardAnswer =
  | (Answering & { readonly outcome: 'result'; readonly answer: CallAnswer })
  | (Answering & { readonly outcome: Exclude<AnsweredOnce['outcome'], 'result'> });

export interface ChatMessage {
  readonly ts: string;
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly thread_ts?: string;
}

export interface Replying {
  readonly channel: string;
  readonly thread?: string | undefined;
  readonly user: string;
  readonly text?: string;
}

export interface ChatBoard {
  readonly answerOf: (call: OneCall) => BoardAnswer;
  readonly posted: () => readonly ChatMessage[];
  readonly reply: (replying: Replying) => string;
}

export const brainUser = 'brain';

function argument(call: OneCall, name: string): string {
  const value = call.input[name];
  return typeof value === 'string' ? value : '';
}

export function answered(document: unknown): BoardAnswer {
  return {
    outcome: 'result',
    answer: { content: [{ type: 'text', text: JSON.stringify(document) }] },
    detail: '',
    retryAfterMs: null,
  };
}

function threadOf(thread: string) {
  return thread === '' ? {} : { thread_ts: thread };
}

export function chatBoard(): ChatBoard {
  const messages: ChatMessage[] = [];
  const nextTs = () => `1699.${String(messages.length + 1).padStart(6, '0')}`;
  const post = (call: OneCall): BoardAnswer => {
    const ts = nextTs();
    const channel = argument(call, 'channel');
    messages.push({
      ts,
      channel,
      user: brainUser,
      text: argument(call, 'text'),
      ...threadOf(argument(call, 'thread_ts')),
    });
    return answered({ ok: true, channel, ts });
  };
  const read = (call: OneCall): BoardAnswer => {
    const ts = argument(call, 'ts');
    const oldest = Number(argument(call, 'oldest'));
    const inThread = (message: ChatMessage) => ts === '' || message.ts === ts || message.thread_ts === ts;
    return answered({
      messages: messages.filter(
        (message) => message.channel === argument(call, 'channel') && inThread(message) && Number(message.ts) > oldest,
      ),
    });
  };
  return {
    answerOf: (call) => (call.reference.tool === 'thread_replies' ? read(call) : post(call)),
    posted: () => messages.filter(({ user }) => user === brainUser),
    reply: ({ channel, thread, user, text }) => {
      const ts = nextTs();
      messages.push({ ts, channel, user, ...(text === undefined ? {} : { text }), ...threadOf(thread ?? '') });
      return ts;
    },
  };
}
