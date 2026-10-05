import type { PublicEvent } from './public-event.ts';
import type { RecordedEvent } from './recorded-read.ts';

export interface Presenter {
  readonly streamKind: string;
  readonly publicNames: Readonly<Record<string, string | null>>;
  readonly present: (recorded: RecordedEvent) => PublicEvent | null;
}
