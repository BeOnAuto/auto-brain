import type { ProgramPool } from '@beonauto/workflow-engine/dsl';

export interface FoldingSettings {
  readonly budget: number;
  readonly memoryBytes: number;
  readonly stackBytes: number;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
  readonly worker?: Readonly<URL>;
}

export interface ViewsFolding {
  readonly definitionType: string;
  readonly pool: ProgramPool;
  readonly folding: FoldingSettings;
  readonly overtimesBeforeStall: number;
}

export const waitForAWorkerMs = 10_000;

const marginOfAPageMs = 5000;

export function pageDeadlineMs({ foldDeadlineMs, pageBudgetMs }: FoldingSettings): number {
  return pageBudgetMs + foldDeadlineMs + marginOfAPageMs;
}

export function shareOfThePool({ workers }: Pick<ProgramPool, 'workers'>): number {
  return Math.max(1, Math.floor(workers / 2));
}
