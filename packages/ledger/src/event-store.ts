import type { Schema } from 'effect';

export interface EncodedEvent {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export interface RecordedStream {
  readonly version: number;
  readonly events: readonly unknown[];
}

export interface EventStore {
  readonly mostEventsInOneAppend: number;
  readonly read: (stream: string, after?: number) => Promise<RecordedStream>;
  readonly append: (stream: string, events: readonly EncodedEvent[], expectedVersion: number) => Promise<void>;
  readonly migrate: () => Promise<void>;
  readonly close: () => Promise<void>;
}
