import type { AppendSignal } from '@beonauto/ledger';
import { unitMemoryBytes, workerStackBytes, type ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { FoldingSettings, ProjectorSettings } from '../projector/projector-settings.ts';
import type { ViewDetails } from '../views/view-details.ts';
import type { KeptView } from '../views/view-rows.ts';
import { testFoldWorker } from './test-fold-workers.ts';

export interface Brain {
  readonly org: string;
  readonly brain: string;
}

export const alpha: Brain = { org: 'acme', brain: 'alpha' };

export const alphaKey = 'brain/acme/alpha/';

export const viewTestTimeoutMs = 60_000;

export function brainKeyOf({ org, brain }: Brain): string {
  return `brain/${org}/${brain}/`;
}

export const succeeded = [{ type: 'run_succeeded' }];

export function detailsOf(fold: string, filters: ViewDetails['filters'], more: Partial<ViewDetails> = {}): ViewDetails {
  return { language: 'typescript', fold, foldLine: 30, filters, initial: {}, ...more };
}

export function foldOf(body: string, view = 'unknown'): string {
  return `export function fold(view: ${view}, event: any): ${view} {\n  ${body}\n}`;
}

export const counting = detailsOf(foldOf('return view + 1;', 'number'), succeeded, { initial: 0 });

export const collecting = detailsOf(foldOf('return [...view, event.data.output];', 'unknown[]'), succeeded, {
  initial: [],
});

export const measuredEnvironment: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]: readonly [string, string | undefined]) =>
    key === 'NODE_V8_COVERAGE' && value !== undefined ? [[key, value]] : [],
  ),
);

export function foldingOf(): FoldingSettings {
  return {
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    worker: testFoldWorker,
  };
}

export type ViewSettingsOf = (more?: Partial<ProjectorSettings>) => ProjectorSettings;

export function settingsOver(pool: ProgramPool, appends: AppendSignal): ViewSettingsOf {
  return (more = {}) => ({
    definitionType: 'recall',
    pool,
    folding: foldingOf(),
    brainsAtOnce: 4,
    rebuildsAtOnce: 4,
    pagesPerWake: 10,
    overtimesBeforeStall: 20,
    appends,
    ...more,
  });
}

export function isLive({ phase }: KeptView): boolean {
  return phase === 'live';
}

export function isStalled({ phase }: KeptView): boolean {
  return phase === 'stalled';
}

export function liveWith(folded: number): (view: KeptView) => boolean {
  return (view) => isLive(view) && view.folded === folded;
}

export function liveAt(version: number): (view: KeptView) => boolean {
  return (view) => isLive(view) && view.version === version;
}

export function foldedAll(folded: number): (view: KeptView) => boolean {
  return (view) => view.folded === folded;
}

export function liveFromSomewhere(view: KeptView): boolean {
  return isLive(view) && view.checkpoint !== null;
}
