import type { AppendSignal } from '@beonauto/ledger';
import { liftedLimits, type ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { FoldingSettings, ProjectorSettings } from '../projector/projector-settings.ts';
import type { ViewDetails } from '../views/view-details.ts';
import type { KeptView } from '../views/view-rows.ts';

export interface Brain {
  readonly org: string;
  readonly brain: string;
}

export const alpha: Brain = { org: 'acme', brain: 'alpha' };

export const alphaKey = 'brain/acme/alpha/';

export const viewTestTimeoutMs = 60_000;

export const breaksTheWorker = 'breaks the worker';

export const sleepsBeforeItIsFolded = 'sleeps before it is folded';

export const sleepBeforeItIsFoldedMs = 1600;

const breakingWorkerSource = [
  "import { parentPort, workerData } from 'node:worker_threads';",
  `import { foldAnswerOf, progressOf } from '${import.meta.resolve('@beonauto/workflow-engine/worker')}';`,
  'const events = JSON.parse(String(workerData.events));',
  'const progress = progressOf(workerData);',
  'const folding = (event, view) => {',
  '  progress.mark(event, view);',
  `  if (events[event]?.data?.output === '${breaksTheWorker}') throw new Error('broken on purpose');`,
  '};',
  'const now = () => performance.timeOrigin + performance.now();',
  'parentPort.postMessage(foldAnswerOf(workerData, { now, folding, checkOf: () => () => undefined }), []);',
].join('\n');

export const breakingFoldWorker = new URL(`data:text/javascript,${encodeURIComponent(breakingWorkerSource)}`);

export function brainKeyOf({ org, brain }: Brain): string {
  return `brain/${org}/${brain}/`;
}

const foldDialect = {
  refused: [
    { name: 'now', why: 'reads the clock' },
    { name: '$ARGS', why: 'reads arguments a fold is never given' },
  ],
  variables: ['event'],
};

export const succeeded = [{ type: 'execution_succeeded' }];

export function detailsOf(fold: string, filters: ViewDetails['filters'], more: Partial<ViewDetails> = {}): ViewDetails {
  return { language: 'jq', fold, foldLine: 30, filters, initial: {}, ...more };
}

export const counting = detailsOf('. + 1', succeeded, { initial: 0 });

export const collecting = detailsOf('. + [$event.data.output]', succeeded, { initial: [] });

const testFoldWorker = new URL('./test-fold-worker.ts', import.meta.url);

export const measuredEnvironment: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]: readonly [string, string | undefined]) =>
    key === 'NODE_V8_COVERAGE' && value !== undefined ? [[key, value]] : [],
  ),
);

export function foldingOf(): FoldingSettings {
  return {
    dialect: foldDialect,
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    worker: testFoldWorker,
  };
}

export type ViewSettingsOf = (more?: Partial<ProjectorSettings>) => ProjectorSettings;

export function settingsOver(pool: ProgramPool, appends: AppendSignal): ViewSettingsOf {
  return (more = {}) => ({
    definitionType: 'recollection',
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
