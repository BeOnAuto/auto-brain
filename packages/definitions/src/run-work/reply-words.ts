import type { ReplyEvent } from '../runs/run-events.ts';
import { throughTheTool } from './delivery-words.ts';

export function replyInWords(event: ReplyEvent): string {
  if (event.type === 'reply_taken') {
    return `A reply from the party answered the request, read ${throughTheTool(event)}.`;
  }
  const told = event.told ? 'the party was told how to answer' : 'nobody was told';
  return `A reply from the party was not an answer the function takes, and ${told}.`;
}
