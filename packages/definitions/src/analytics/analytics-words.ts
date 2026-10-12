import { capitalized, counted, listed, plainNumber, type Noun, type PlainLanguage } from '@beonauto/operations';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import { endingsInWords, runsOfWhat } from '../plain-language/reading-words.ts';
import type { PlaybookAnalytics } from './analytics-answer.ts';
import { defaultDays, type WindowRequest } from './analytics-window.ts';

export interface AnalyticsRequest extends WindowRequest {
  readonly type?: string;
  readonly name?: string;
}

const runNoun: Noun = { one: 'run', other: 'runs' };

const endings: readonly ('succeeded' | 'rejected' | 'failed')[] = ['succeeded', 'rejected', 'failed'];

function windowInWords({ days, from, to }: WindowRequest): string {
  if (from !== undefined && to !== undefined && days === undefined) {
    return `from ${from} to ${to}`;
  }
  return from === undefined && to === undefined
    ? `over the last ${plainNumber(days ?? defaultDays)} days`
    : 'over the days asked for';
}

function howTheyEnded(runs: PlaybookAnalytics['runs']): string {
  return listed(
    endings.flatMap((ending) => (runs[ending] === 0 ? [] : [`${plainNumber(runs[ending])} ${endingsInWords[ending]}`])),
  );
}

function tokensInWords({ input, output }: PlaybookAnalytics['tokens']): string {
  return input + output === 0 ? '' : ` They used ${plainNumber(input)} input and ${plainNumber(output)} output tokens.`;
}

function durationInWords(duration: PlaybookAnalytics['duration_ms']): string {
  return duration === null
    ? ''
    : ` Half of those that ran to an end took at most ${plainNumber(duration.p50)} ms, and nineteen in twenty at most ${plainNumber(duration.p95)} ms.`;
}

function activityFound(words: DefinitionWords, analytics: PlaybookAnalytics, request: AnalyticsRequest): string {
  const when = capitalized(windowInWords(request));
  const which = runsOfWhat(words, request);
  const { runs } = analytics;
  if (runs.total === 0) {
    return `${when}, no runs${which} ended in this playbook.`;
  }
  const ended = `${when}, ${counted(runs.total, runNoun)}${which} ended in this playbook: ${howTheyEnded(runs)}.`;
  return `${ended}${tokensInWords(analytics.tokens)}${durationInWords(analytics.duration_ms)}`;
}

export function analyticsWords(words: DefinitionWords): PlainLanguage<AnalyticsRequest, PlaybookAnalytics> {
  return {
    task: 'read how the runs of the playbook went',
    attempt: (request) => `read how the runs${runsOfWhat(words, request)} went ${windowInWords(request)}`,
    outcome: (analytics, request) => activityFound(words, analytics, request),
  };
}
