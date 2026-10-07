import type { Json } from '../dsl/json.ts';
import type { FoldPage } from '../folds/fold-page.ts';
import type { FoldPlace } from '../folds/fold-progress.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramLimits, Variables } from '../programs/program-running.ts';
import type { FoldAnswer } from './fold-messages.ts';
import type { Ending, Interrupted } from './job-endings.ts';
import type { ProgramAnswer } from './program-messages.ts';

export interface PoolSettings {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly worker?: Readonly<URL>;
  readonly foldWorker?: Readonly<URL>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly idleMs?: number;
  readonly jobsPerWorker?: number;
}

export interface ProgramRequest {
  readonly source: string;
  readonly input: Json;
  readonly variables?: Variables;
  readonly dialect: Dialect;
  readonly limits: ProgramLimits;
  readonly deadlineMs: number;
  readonly mostOutputBytes: number;
  readonly worker?: Readonly<URL>;
  readonly context?: Json;
}

export type PoolOutcome = Ending<ProgramAnswer> & { readonly milliseconds: number };

export interface FoldRequest extends FoldPage {
  readonly waitMs: number;
  readonly deadlineMs: number;
  readonly worker?: Readonly<URL>;
}

export type FoldEnding = FoldAnswer | (Interrupted & { readonly progress?: FoldPlace });

export type FoldOutcome = FoldEnding & { readonly milliseconds: number };

export interface ProgramPool {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly run: (request: ProgramRequest, signal?: Readonly<AbortSignal>) => Promise<PoolOutcome>;
  readonly fold: (request: FoldRequest, signal?: Readonly<AbortSignal>) => Promise<FoldOutcome>;
  readonly close: () => Promise<void>;
}
