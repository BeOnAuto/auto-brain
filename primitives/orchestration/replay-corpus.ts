import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { WorkflowHandle } from '@temporalio/client';
import { historyToJSON } from '@temporalio/common/lib/proto-utils.js';

export interface RecordedHistory {
  readonly workflowId: string;
  readonly history: unknown;
}

export const probeWorkflowsPath = fileURLToPath(new URL('temporal-probe-workflows.ts', import.meta.url));

const corpus = fileURLToPath(new URL('histories/', import.meta.url));

type History = Awaited<ReturnType<WorkflowHandle['fetchHistory']>>;

export async function recordHistory(name: string, fetchHistory: () => Promise<History>): Promise<void> {
  if (process.env['RECORD_HISTORIES'] !== '1') {
    return;
  }
  const history = await fetchHistory();
  mkdirSync(corpus, { recursive: true });
  const anonymous = historyToJSON(history).replaceAll(hostname(), 'recorded-host');
  writeFileSync(`${corpus}${name}.json`, `${anonymous}\n`);
}

export function recordedHistories(): readonly RecordedHistory[] {
  return readdirSync(corpus)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => {
      const history: unknown = JSON.parse(readFileSync(`${corpus}${file}`, 'utf8'));
      return { workflowId: file.replace(/\.json$/u, ''), history };
    });
}
