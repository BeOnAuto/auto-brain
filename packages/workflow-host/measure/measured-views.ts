import { unitMemoryBytes, workerStackBytes, type ProgramPool } from '@beonauto/workflow-engine/dsl';

import { someFolder } from '../src/projector/folder.ts';
import type { ProjectorSettings } from '../src/projector/projector-settings.ts';
import { viewsFolder } from '../src/views/views-folder.ts';

export function measuredViews(pool: ProgramPool): ProjectorSettings {
  const folding = {
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
  };
  return {
    folders: [
      someFolder(viewsFolder({ definitionType: 'recall', pool, folding, overtimesBeforeStall: 20, rebuildsAtOnce: 4 })),
    ],
    brainsAtOnce: 4,
    pagesPerWake: 10,
  };
}
