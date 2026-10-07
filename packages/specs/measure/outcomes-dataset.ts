import { randomBytes } from 'node:crypto';

export interface OutcomeRow {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
  readonly created: string;
}

const daysInTheWindow = 30;

export const firstDay = '2026-09-07';

export const lastDay = '2026-10-06';

const dayInMilliseconds = 86_400_000;

const firstMoment = Date.parse(`${firstDay}T00:00:00Z`);

function text(bytes: number): string {
  return randomBytes(bytes / 2).toString('hex');
}

function statusOf(run: number): string {
  if (run % 20 === 0) {
    return 'execution_rejected';
  }
  return run % 33 === 1 ? 'execution_failed' : 'execution_succeeded';
}

function usageOf(run: number) {
  return { input: { total: 1000 + (run % 500), cache_read: 600 }, output: { total: 200 + (run % 50) } };
}

function finishOf(run: number, at: string, recordBytes: number): Readonly<Record<string, unknown>> {
  const status = statusOf(run);
  const fact = { type: status, by: 'user-1', at };
  if (status === 'execution_failed') {
    return fact;
  }
  if (status === 'execution_rejected') {
    return {
      ...fact,
      rejection: { reason: 'unavailable', detail: 'The answer is not JSON' },
      record: { usage: usageOf(run) },
    };
  }
  return { ...fact, output: { text: text(640) }, record: { usage: usageOf(run), prompt: text(recordBytes) } };
}

function row(stream: string, position: number, data: Readonly<Record<string, unknown>>, at: string): OutcomeRow {
  return { stream, position, type: String(data['type']), data: JSON.stringify(data), created: at };
}

export function runOf(brain: string, run: number, recordBytes: number): readonly OutcomeRow[] {
  const startedAt = firstMoment + (run % daysInTheWindow) * dayInMilliseconds + (run % 80_000) * 1000;
  const at = new Date(startedAt).toISOString();
  const finishedAt = new Date(startedAt + 100 + (run % 50) * 97).toISOString();
  const stream = `brain/o1/${brain}/executions/${String(run).padStart(8, '0')}`;
  const started = { type: 'execution_started', primitive: 'inference', name: `fn-${run % 20}`, spec_version: 1 };
  return [
    row(stream, 1, { ...started, input: { text: text(320) }, by: 'user-1', at }, at),
    row(stream, 2, finishOf(run, finishedAt, recordBytes), finishedAt),
  ];
}
