import type { AppendSignal } from '@beonauto/ledger';
import type { Dialect, ProgramLimits, ProgramPool } from '@beonauto/workflow-engine/dsl';

export interface FoldingSettings {
  readonly dialect: Dialect;
  readonly variable: string;
  readonly limits: ProgramLimits;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
  readonly worker?: Readonly<URL>;
}

export interface ProjectorSettings {
  readonly definitionType: string;
  readonly pool: ProgramPool;
  readonly folding: FoldingSettings;
  readonly brainsAtOnce: number;
  readonly rebuildsAtOnce: number;
  readonly pagesPerWake: number;
  readonly overtimesBeforeStall: number;
  readonly appends?: AppendSignal;
}

export const recordsInAPage = 100;

export const waitForAWorkerMs = 10_000;

const marginOfAPageMs = 1000;

export function pageDeadlineMs({ foldDeadlineMs, pageBudgetMs }: FoldingSettings): number {
  return pageBudgetMs + foldDeadlineMs + marginOfAPageMs;
}

export function shareOfThePool({ workers }: Pick<ProgramPool, 'workers'>): number {
  return Math.max(1, Math.floor(workers / 2));
}
