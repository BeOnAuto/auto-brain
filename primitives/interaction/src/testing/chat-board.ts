import type { AnsweredOnce, DeliveryCall } from '@beonauto/mcp';

export type BoardAnswer = AnsweredOnce extends infer Answer
  ? Answer extends AnsweredOnce
    ? Omit<Answer, 'kind' | 'fields' | 'durationMs'>
    : never
  : never;

export interface ChatMessage {
  readonly ts: string;
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly thread_ts?: string;
}

export interface ChatBoard {
  readonly answerOf: (call: DeliveryCall) => BoardAnswer;
  readonly posted: () => readonly ChatMessage[];
}

export const brainUser = 'brain';

function argument(call: DeliveryCall, name: string): string {
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

function threadOf(call: DeliveryCall) {
  const thread = argument(call, 'thread_ts');
  return thread === '' ? {} : { thread_ts: thread };
}

export function chatBoard(): ChatBoard {
  const messages: ChatMessage[] = [];
  const post = (call: DeliveryCall): BoardAnswer => {
    const ts = `1699.${String(messages.length + 1).padStart(6, '0')}`;
    const channel = argument(call, 'channel');
    messages.push({ ts, channel, user: brainUser, text: argument(call, 'text'), ...threadOf(call) });
    return answered({ ok: true, channel, ts });
  };
  return {
    answerOf: post,
    posted: () => messages.filter(({ user }) => user === brainUser),
  };
}
