import type { Schema } from 'effect';

export interface RecordedEvent {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

interface RecordedStream {
  readonly version: number;
  readonly events: readonly unknown[];
}

export interface EventStore {
  readonly read: (stream: string) => Promise<RecordedStream>;
  readonly append: (stream: string, events: readonly RecordedEvent[], expectedVersion: number) => Promise<void>;
  readonly migrate: () => Promise<void>;
  readonly close: () => Promise<void>;
}
