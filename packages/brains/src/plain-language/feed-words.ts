import { counted, type Noun, type RecordedOrder } from '@beonauto/operations';

interface Feed {
  readonly events: readonly unknown[];
  readonly has_more: boolean;
}

interface FeedRequest {
  readonly order?: RecordedOrder;
  readonly type?: string;
  readonly since?: string;
  readonly cursor?: string;
  readonly run_id?: string;
}

const eventNoun: Noun = { one: 'event', other: 'events' };

const orderInWords: Readonly<Record<RecordedOrder, string>> = { asc: 'oldest first', desc: 'newest first' };

function ofTheKind({ type, run_id: run }: FeedRequest): string {
  const kind = type === undefined ? '' : ' of the kind asked for';
  return run === undefined ? kind : `${kind} of the run asked for`;
}

function sinceTheTime({ since }: FeedRequest): string {
  return since === undefined ? '' : ' since the time given';
}

function nothingFound(request: FeedRequest): string {
  if (request.cursor !== undefined) {
    return `There is nothing more${ofTheKind(request)} to read in this brain${sinceTheTime(request)}.`;
  }
  const filtered = request.type !== undefined || request.since !== undefined || request.run_id !== undefined;
  return `Nothing${ofTheKind(request)} has happened in this brain${sinceTheTime(request)}${filtered ? '' : ' yet'}.`;
}

export function eventsFound({ events, has_more: hasMore }: Feed, request: FeedRequest): string {
  if (events.length > 0) {
    const found = `Found ${counted(events.length, eventNoun)}${ofTheKind(request)} in this brain${sinceTheTime(request)}`;
    return `${found}, ${orderInWords[request.order ?? 'desc']}.${hasMore ? ' More remain after these.' : ''}`;
  }
  return hasMore
    ? `This page shows nothing${ofTheKind(request)}, but there is more of this brain to read.`
    : nothingFound(request);
}
