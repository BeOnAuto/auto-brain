import type { AppendSignal } from '@beonauto/ledger';

import type { SomeFolder } from './folder.ts';

export interface ProjectorSettings {
  readonly folders: readonly SomeFolder[];
  readonly brainsAtOnce: number;
  readonly rebuildsAtOnce: number;
  readonly pagesPerWake: number;
  readonly appends?: AppendSignal;
}
