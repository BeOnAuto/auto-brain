import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '@beonauto/mcp';
import {
  strictRecordedDecoder,
  type KeptContent,
  type PresentedFact,
  type Presenter,
  type Recorded,
} from '@beonauto/operations';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import {
  cancelAsked,
  runBrokeDown,
  runFinished,
  runRejected,
  runStarted,
  toolAnswered,
  toolCalled,
  toolFailed,
} from '../plain-language/event-words.ts';
import { deferralAccount, deliveryAccount, replyAccount } from '../run-work/run-work-accounts.ts';
import { RunEventSchema, type RunEvent, type ToolCallEvent } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { cutAtCodePoint, issuesShown, mostDetailBytes, mostNameBytes } from './event-data.ts';

type Shown<Type extends RunEvent['type']> = Recorded<Extract<RunEvent, { readonly type: Type }>>;

function rejectionShown(rejection: RunRejection) {
  const detail = cutAtCodePoint(rejection.detail, mostDetailBytes);
  if (rejection.reason === 'invalid_input') {
    return { reason: rejection.reason, detail, ...issuesShown(rejection.issues) };
  }
  if (rejection.reason === 'cancelled' || rejection.reason === 'unanswered') {
    const { reason, kind } = rejection;
    return { reason, detail, kind };
  }
  const { reason, kind, because } = rejection;
  return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
}

function toolCallFact(event: Recorded<ToolCallEvent>, content: KeptContent): PresentedFact {
  if (event.type === 'tool_call_started') {
    const { data } = event;
    const server = named(data.server);
    const tool = named(data.tool);
    return {
      type: event.type,
      summary: toolCalled(data.number, server, tool),
      data: { ...callFieldsShown(data), ...keptArgumentsOf(data, content) },
    };
  }
  if (event.type === 'tool_call_answered') {
    const { data } = event;
    return {
      type: event.type,
      summary: toolAnswered(data.number, data.is_error),
      data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
    };
  }
  const { data } = event;
  return { type: event.type, summary: toolFailed(data.number, data.because), data: callFieldsShown(data) };
}

function startFact(words: DefinitionWords, { type, data, context }: Shown<'run_started'>): PresentedFact {
  const { definitionType = '', definitionName = '', trigger } = context;
  return { type, summary: runStarted(words, definitionType, definitionName, trigger), data };
}

function cancelFact({ type, data }: Shown<'run_cancel_requested'>): PresentedFact {
  return {
    type,
    summary: cancelAsked(data.kind),
    data: { ...data, reason: cutAtCodePoint(data.reason, mostDetailBytes) },
  };
}

function endingFact(event: Shown<'run_succeeded' | 'run_rejected' | 'run_failed'>): PresentedFact {
  if (event.type === 'run_succeeded') {
    return { type: event.type, summary: runFinished, data: event.data };
  }
  if (event.type === 'run_rejected') {
    const { rejection, record } = event.data;
    const data = { ...rejectionShown(rejection), ...(record === undefined ? {} : { record }) };
    return { type: event.type, summary: runRejected(rejection), data };
  }
  const { incident } = event.data;
  return { type: event.type, summary: runBrokeDown, data: incident === undefined ? {} : { incident: named(incident) } };
}

const toolCallTypes: ReadonlySet<string> = new Set(['tool_call_started', 'tool_call_answered', 'tool_call_failed']);

const endingTypes: ReadonlySet<string> = new Set(['run_succeeded', 'run_rejected', 'run_failed']);

const replyTypes: ReadonlySet<string> = new Set(['reply_taken', 'reply_refused']);

function isToolCall(event: Recorded<RunEvent>): event is Recorded<ToolCallEvent> {
  return toolCallTypes.has(event.type);
}

function isEnding(event: Recorded<RunEvent>): event is Shown<'run_succeeded' | 'run_rejected' | 'run_failed'> {
  return endingTypes.has(event.type);
}

function isReply(event: Recorded<RunEvent>): event is Shown<'reply_taken' | 'reply_refused'> {
  return replyTypes.has(event.type);
}

function runFactOf(words: DefinitionWords, event: Recorded<RunEvent>, content: KeptContent): PresentedFact | undefined {
  const runWords = words.runWordsOf(event.context.definitionType);
  if (event.type === 'run_deferred') {
    return deferralAccount(runWords, event.data);
  }
  if (isToolCall(event)) {
    return toolCallFact(event, content);
  }
  if (isReply(event)) {
    return replyAccount(event);
  }
  if (event.type === 'run_started') {
    return startFact(words, event);
  }
  if (event.type === 'run_cancel_requested') {
    return cancelFact(event);
  }
  return isEnding(event) ? endingFact(event) : deliveryAccount(runWords, event, content);
}

const shownNames: Readonly<Record<Exclude<RunEvent['type'], 'run_deferred'>, readonly [string]>> = {
  run_started: ['run_started'],
  run_succeeded: ['run_succeeded'],
  run_rejected: ['run_rejected'],
  run_failed: ['run_failed'],
  run_cancel_requested: ['run_cancel_requested'],
  tool_call_started: ['tool_call_started'],
  tool_call_answered: ['tool_call_answered'],
  tool_call_failed: ['tool_call_failed'],
  delivery_started: ['delivery_started'],
  delivery_succeeded: ['delivery_succeeded'],
  delivery_failed: ['delivery_failed'],
  delivery_refused: ['delivery_refused'],
  reply_taken: ['reply_taken'],
  reply_refused: ['reply_refused'],
};

const decodeRunEvent = strictRecordedDecoder(RunEventSchema);

export function runPresenter(words: DefinitionWords): Presenter {
  return {
    streamKind: 'runs',
    publicNames: { ...shownNames, run_deferred: words.deferralTypes },
    present: (recorded, content) => {
      const fact = runFactOf(words, decodeRunEvent(recorded), content);
      return fact === undefined ? [] : [fact];
    },
  };
}
