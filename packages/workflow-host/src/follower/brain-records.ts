import { recordedReaderOf, type EventStore } from '@beonauto/ledger';
import type { BrainAddress, RecordedEvent, RecordedPage } from '@beonauto/operations';
import { Effect } from 'effect';

const recordsInAPage = 100;

const definitionTypes: readonly string[] = ['definition_created', 'definition_updated', 'definition_retired'];

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionTypes,
]);

export const noRecordTypes: ReadonlySet<string> = new Set();

export function recordTypesOf(eventTypes: readonly string[]): ReadonlySet<string> {
  const facts = eventTypes.filter((type) => factTypes.has(type));
  return new Set(facts.length < eventTypes.length ? [...facts, 'event_published'] : facts);
}

export interface BrainRecords {
  readonly after: (
    brain: BrainAddress,
    cursor: string | null,
    delivers: ReadonlySet<string>,
  ) => Effect.Effect<RecordedPage>;
  readonly tail: (brain: BrainAddress) => Effect.Effect<string | null>;
}

export function relativeRecord(brainKey: string, record: RecordedEvent): RecordedEvent {
  return { ...record, stream: record.stream.slice(brainKey.length) };
}

export function brainRecordsOf(store: EventStore): BrainRecords {
  const read = recordedReaderOf(store);
  return {
    after: (brain, cursor, delivers) =>
      Effect.orDie(
        read(
          brain,
          { kind: 'everything' },
          {
            order: 'asc',
            limit: recordsInAPage,
            dataOf: [...new Set([...definitionTypes, ...delivers])],
            ...(cursor === null ? {} : { cursor }),
          },
        ),
      ),
    tail: (brain) =>
      Effect.orDie(read(brain, { kind: 'everything' }, { order: 'desc', limit: 1, dataOf: [] })).pipe(
        Effect.map(({ records }) => records.reduce<string | null>((_, { cursor }) => cursor, null)),
      ),
  };
}
