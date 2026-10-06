import { recordedReaderOf, type EventStore } from '@beonauto/ledger';
import type { BrainAddress, RecordedEvent, RecordedPage } from '@beonauto/operations';
import { Effect } from 'effect';

const recordsInAPage = 100;

const specTypes: readonly string[] = ['spec_created', 'spec_updated', 'spec_retired'];

const typesWithData: readonly string[] = [
  'event_published',
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
  ...specTypes,
];

export interface BrainRecords {
  readonly after: (brain: BrainAddress, cursor: string | null, withData: boolean) => Effect.Effect<RecordedPage>;
  readonly tail: (brain: BrainAddress) => Effect.Effect<string | null>;
}

export function relativeRecord(brainKey: string, record: RecordedEvent): RecordedEvent {
  return { ...record, stream: record.stream.slice(brainKey.length) };
}

export function brainRecordsOf(store: EventStore): BrainRecords {
  const read = recordedReaderOf(store);
  return {
    after: (brain, cursor, withData) =>
      Effect.orDie(
        read(
          brain,
          { kind: 'everything' },
          {
            order: 'asc',
            limit: recordsInAPage,
            dataOf: withData ? typesWithData : specTypes,
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
