import type { KeptContent, PresentedFact, Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import { cutAsStored } from '../bounds/text-bytes.ts';
import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '../calls/shown-calls.ts';
import { answeredInWords, failedInWords, inWords } from '../names/tool-words.ts';
import { ToolTestEventSchema, toolTestsKind, type ToolTestEvent } from './tool-test-events.ts';

const mostNameBytes = 256;

const decodeToolTestEvent = Schema.decodeUnknownSync(Schema.toCodecJson(ToolTestEventSchema));

function factOf(event: ToolTestEvent, content: KeptContent): PresentedFact {
  if (event.type === 'tool_test_started') {
    const { data } = event;
    const server = cutAsStored(data.server, mostNameBytes);
    const tool = cutAsStored(data.tool, mostNameBytes);
    return {
      type: event.type,
      summary: `Someone allowed to change the brain tested the ${inWords(tool)} tool of ${inWords(server)}.`,
      data: { ...callFieldsShown(data), ...keptArgumentsOf(data, content) },
    };
  }
  if (event.type === 'tool_test_answered') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The tested tool ${answeredInWords(data.is_error)}.`,
      data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
    };
  }
  const { data } = event;
  return { type: event.type, summary: `The tested tool ${failedInWords[data.because]}.`, data: callFieldsShown(data) };
}

export const toolTestPresenter: Presenter = {
  streamKind: toolTestsKind,
  publicNames: {
    tool_test_started: ['tool_test_started'],
    tool_test_answered: ['tool_test_answered'],
    tool_test_failed: ['tool_test_failed'],
  },
  present: ({ type, data }, content) => [factOf(decodeToolTestEvent({ type, data }), content)],
};
