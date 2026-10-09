import { counted, listed, plainNumber, quoted, type Noun, type RecordedOrder } from '@beonauto/operations';

import type { RunStatus } from '../reading/run-status.ts';
import type { DefinitionWords } from './definition-words.ts';

export interface RunFilters {
  readonly type?: string;
  readonly name?: string;
  readonly status?: RunStatus;
  readonly cursor?: string;
}

interface Page {
  readonly has_more: boolean;
}

interface ListedRuns extends Page {
  readonly runs: readonly { readonly status: RunStatus }[];
}

interface History extends Page {
  readonly events: readonly unknown[];
}

interface HistoryRequest {
  readonly order?: RecordedOrder;
  readonly cursor?: string;
}

const runNoun: Noun = { one: 'run', other: 'runs' };

const eventNoun: Noun = { one: 'event', other: 'events' };

const moreRemain = ' More remain after these.';

export const endingsInWords: Readonly<Record<RunStatus, string>> = {
  started: 'still running',
  succeeded: 'finished',
  rejected: 'did not go through',
  failed: 'broke down',
};

const orderInWords: Readonly<Record<RecordedOrder, string>> = { asc: 'oldest first', desc: 'newest first' };

export function runsOfWhat(words: DefinitionWords, { type, name }: RunFilters): string {
  if (type === undefined) {
    return name === undefined ? '' : ` of anything named ${quoted(name)}`;
  }
  return name === undefined ? ` of ${words.nounOf(type).other}` : ` of ${words.named(type, name)}`;
}

function filtersInWords(words: DefinitionWords, filters: RunFilters): string {
  const { status } = filters;
  const endedSo = status === undefined ? '' : ` that ${status === 'started' ? 'are ' : ''}${endingsInWords[status]}`;
  return `${runsOfWhat(words, filters)}${endedSo}`;
}

export function runsToList(words: DefinitionWords, filters: RunFilters): string {
  return `list the runs${filtersInWords(words, filters)}`;
}

function howTheyEnded(runs: ListedRuns['runs']): string {
  const endings = Object.entries(endingsInWords).flatMap(([status, ending]: readonly [string, string]) => {
    const count = runs.filter((run) => run.status === status).length;
    return count === 0 ? [] : [`${plainNumber(count)} ${ending}`];
  });
  return `: ${listed(endings)}`;
}

function noRuns(described: string, { has_more }: Page, { cursor }: RunFilters): string {
  if (has_more) {
    return `This page holds no runs${described}, but there are more runs to look through.`;
  }
  if (cursor !== undefined) {
    return `There are no more runs${described}.`;
  }
  return described === '' ? 'This brain has no runs yet.' : `This brain has no runs${described}.`;
}

export function runsListed(words: DefinitionWords, page: ListedRuns, filters: RunFilters): string {
  const described = filtersInWords(words, filters);
  const { runs, has_more: hasMore } = page;
  if (runs.length === 0) {
    return noRuns(described, page, filters);
  }
  const endings = filters.status === undefined ? howTheyEnded(runs) : '';
  return `Listed ${counted(runs.length, runNoun)}${described}, newest first${endings}.${hasMore ? moreRemain : ''}`;
}

export function historyFound(
  { events, has_more: hasMore }: History,
  { order = 'asc', cursor }: HistoryRequest,
): string {
  if (events.length > 0) {
    const found = `Found ${counted(events.length, eventNoun)} in the history of the run, ${orderInWords[order]}.`;
    return `${found}${hasMore ? moreRemain : ''}`;
  }
  if (hasMore) {
    return 'This page shows nothing of the run, but there is more of its history to read.';
  }
  return cursor === undefined ? 'The run has nothing to show yet.' : 'There is nothing more to show of the run.';
}
