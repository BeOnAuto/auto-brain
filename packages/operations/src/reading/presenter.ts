import type { Schema } from 'effect';

import type { RecordedEvent } from './recorded-read.ts';

export interface PresentedPart {
  readonly number: number;
  readonly causedBy: number;
}

export interface PresentedFact {
  readonly type: string;
  readonly summary: string;
  readonly data: Schema.JsonObject;
  readonly part?: PresentedPart;
}

export type KeptContent = (sha256: string) => string | undefined;

export interface Presenter {
  readonly streamKind: string;
  readonly publicNames: Readonly<Record<string, readonly string[]>>;
  readonly present: (recorded: RecordedEvent, content: KeptContent) => readonly PresentedFact[];
}
