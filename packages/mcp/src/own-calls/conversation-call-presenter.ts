import { quoted, type KeptContent, type PresentedFact, type Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { cutAsStored } from '../bounds/text-bytes.ts';
import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '../calls/shown-calls.ts';
import { failedInWords, toolInWords } from '../names/tool-words.ts';
import {
  ConversationCallEventSchema,
  conversationCallsKind,
  type ConversationCallEvent,
  type ReadingFailedBecause,
  type TellingFailedBecause,
} from './conversation-call-events.ts';

const mostNameBytes = 256;

const counted = new Intl.NumberFormat('en');

const decodeConversationCall = Schema.decodeUnknownSync(Schema.toCodecJson(ConversationCallEventSchema));

const failedReadWords: Readonly<Record<ReadingFailedBecause, string>> = {
  tool_error: 'the tool answered with an error',
  arguments_refused: 'the tool server refused the arguments of the read',
  server_failure: 'the tool server failed',
  timed_out: `the tool server did not answer within ${counted.format(toolBounds.callMs / 1000)} seconds`,
  cancelled: 'the read was cancelled',
  unreadable: 'what the tool answered could not be read as a list of replies',
  too_large: `the tool answered more than the ${counted.format(toolBounds.readAnswerBytes)} bytes a read may take`,
  tool_not_offered: 'the tool server no longer offers the tool to this brain',
  not_sent: 'its arguments could not be rendered, so nothing was sent',
};

const failedTellingWords: Readonly<Record<TellingFailedBecause, string>> = {
  ...failedInWords,
  tool_error: 'answered with an error of its own',
  tool_not_offered: 'was no longer offered by its server',
};

function named(text: string): string {
  return cutAsStored(text, mostNameBytes);
}

interface OnTheTool {
  readonly server: string;
  readonly tool: string;
}

function throughTheTool({ server, tool }: OnTheTool): string {
  return `through ${toolInWords({ server: named(server), tool: named(tool) })}`;
}

interface OnTheConversation extends OnTheTool {
  readonly conversation: string;
}

function whereOf(data: OnTheConversation): string {
  return `the conversation ${quoted(named(data.conversation))} ${throughTheTool(data)}`;
}

type Reading = Extract<ConversationCallEvent, { readonly type: 'replies_read' | 'reading_failed' }>;

function readingFact(event: Reading, content: KeptContent): PresentedFact {
  const shown = { ...keptArgumentsOf(event.data, content), ...keptAnswerOf(event.data, content) };
  if (event.type === 'replies_read') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The brain looked for new replies in ${whereOf(data)} and found ${data.replies}, took ${data.taken} as an answer and refused ${data.refused}.`,
      data: { ...callFieldsShown(data), ...shown },
    };
  }
  const { data } = event;
  return {
    type: event.type,
    summary: `The brain could not read the replies of ${whereOf(data)}: ${failedReadWords[data.because]}.`,
    data: { ...callFieldsShown(data), ...shown },
  };
}

function factOf(event: ConversationCallEvent, content: KeptContent): PresentedFact {
  if (event.type === 'replies_read' || event.type === 'reading_failed') {
    return readingFact(event, content);
  }
  if (event.type === 'telling_started') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The brain told the party how to answer ${throughTheTool(data)}.`,
      data: { ...callFieldsShown(data), ...keptArgumentsOf(data, content) },
    };
  }
  if (event.type === 'telling_succeeded') {
    const { data } = event;
    return {
      type: event.type,
      summary: 'The tool that told the party answered.',
      data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
    };
  }
  const { data } = event;
  return {
    type: event.type,
    summary: `The tool that told the party ${failedTellingWords[data.because]}.`,
    data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
  };
}

export const conversationCallPresenter: Presenter = {
  streamKind: conversationCallsKind,
  publicNames: {
    telling_started: ['telling_started'],
    telling_succeeded: ['telling_succeeded'],
    telling_failed: ['telling_failed'],
    replies_read: ['replies_read'],
    reading_failed: ['reading_failed'],
  },
  present: ({ type, data }, content) => [factOf(decodeConversationCall({ type, data }), content)],
};
