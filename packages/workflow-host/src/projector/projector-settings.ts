import type { AppendSignal } from '@beonauto/ledger';

import type { SomeFolder } from './folder.ts';

export interface ProjectorSettings {
  readonly folders: readonly SomeFolder[];
  readonly playbooksAtOnce: number;
  readonly pagesPerWake: number;
  readonly appends?: AppendSignal;
}
