import type { RepliesIn } from '@beonauto/definitions';

export function conversationKeyOf({ server, tool, key }: RepliesIn): string {
  return `${server}/${tool}/${key}`;
}

export function readingKeyOf(conversationKey: string): string {
  return conversationKey.split('/').slice(2).join('/');
}
