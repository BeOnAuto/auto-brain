import type { EventStore, StoredPage, StoredPlace } from '@beonauto/ledger';
import { brainEventOf, specsStreamOf, type CloudEvent } from '@beonauto/specs';

import { recordsInAPage } from '../projector/projector-settings.ts';
import type { Point } from '../views/view-points.ts';

export interface PageEvent {
  readonly point: Point;
  readonly recordedAt: string;
  readonly record: string;
  readonly event: CloudEvent;
}

interface PassedOver {
  readonly record: string;
  readonly reason: 'unreadable';
}

export interface ReadPage {
  readonly events: readonly PageEvent[];
  readonly definitionsSeen: boolean;
  readonly passedOver: readonly PassedOver[];
  readonly lastExamined: StoredPlace | undefined;
  readonly atTheEnd: boolean;
}

interface PageRead {
  readonly brainKey: string;
  readonly after: Point | undefined;
  readonly types: readonly string[];
  readonly definitionType: string;
}

type StoredRecord = StoredPage['records'][number];

const definitionTypes = ['spec_created', 'spec_updated', 'spec_retired'];

const factTypes: ReadonlySet<string> = new Set([
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
  ...definitionTypes,
]);

export function typesToRead(named: readonly string[]): readonly string[] {
  const published = named.some((type) => !factTypes.has(type)) ? ['event_published'] : [];
  const read = new Set([...named.filter((type) => factTypes.has(type)), ...published, ...definitionTypes]);
  return [...read].toSorted();
}

function eventOf(brainKey: string, record: StoredRecord): CloudEvent | undefined {
  const { id, causationId, correlationId, type, data, recordedAt } = record;
  const stream = record.stream.slice(brainKey.length);
  return brainEventOf({ id, cursor: '', causationId, correlationId, stream, type, data, recordedAt });
}

function placedOf(brainKey: string, record: StoredRecord): PageEvent | PassedOver {
  const event = eventOf(brainKey, record);
  return event === undefined
    ? { record: record.id, reason: 'unreadable' }
    : { point: record.point, recordedAt: record.recordedAt, record: record.id, event };
}

function isPageEvent(placed: PageEvent | PassedOver): placed is PageEvent {
  return 'event' in placed;
}

function isPassedOver(placed: PageEvent | PassedOver): placed is PassedOver {
  return 'reason' in placed;
}

export async function readPage(
  store: EventStore,
  { brainKey, after, types, definitionType }: PageRead,
): Promise<ReadPage> {
  const page = await store.readRecorded(
    brainKey,
    { kind: 'everything' },
    { order: 'asc', limit: recordsInAPage, types, ...(after === undefined ? {} : { after }) },
  );
  const placed = page.records.map((record) => placedOf(brainKey, record));
  const definitions = `${brainKey}${specsStreamOf(definitionType)}`;
  return {
    events: placed.filter((each) => isPageEvent(each)),
    definitionsSeen: page.records.some(({ stream }) => stream === definitions),
    passedOver: placed.filter((each) => isPassedOver(each)),
    lastExamined: page.lastExamined,
    atTheEnd: page.resumeAfter === undefined,
  };
}
