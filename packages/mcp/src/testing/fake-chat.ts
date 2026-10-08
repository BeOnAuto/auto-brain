export interface ChatMessage {
  readonly ts: string;
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly thread_ts?: string;
}

export interface FakeChat {
  readonly post: (input: unknown) => ChatMessage;
  readonly posted: () => readonly ChatMessage[];
}

export const chatBot = 'brain';

function argument(input: unknown, name: string): string {
  const value: unknown = Reflect.get(new Object(input), name);
  return typeof value === 'string' ? value : '';
}

function threadOf(input: unknown) {
  const thread = argument(input, 'thread_ts');
  return thread === '' ? {} : { thread_ts: thread };
}

export function fakeChat(): FakeChat {
  const messages: ChatMessage[] = [];
  return {
    post: (input) => {
      const message = {
        ts: `1699.${String(messages.length + 1).padStart(6, '0')}`,
        channel: argument(input, 'channel'),
        user: chatBot,
        text: argument(input, 'text'),
        ...threadOf(input),
      };
      messages.push(message);
      return message;
    },
    posted: () => messages.filter(({ user }) => user === chatBot),
  };
}
