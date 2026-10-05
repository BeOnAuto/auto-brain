import { randomBytes } from 'node:crypto';

interface Row {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
}

const largeEvery = 200;

export const longRun = 'brain/o1/big/runs/long-running';

const statuses: readonly (readonly [number, number, string])[] = [
  [largeEvery, 13, 'succeeded'],
  [100, 7, 'failed'],
  [20, 5, 'rejected'],
  [25, 3, 'deferred'],
  [33, 1, 'running'],
];

function statusOf(run: number): string {
  return statuses.find(([every, at]) => run % every === at)?.[2] ?? 'succeeded';
}

function text(characters: number): string {
  return randomBytes(characters / 2).toString('hex');
}

export function timeOf(second: number): string {
  return new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString();
}

export function executions(run: number): string {
  return `brain/o1/big/executions/${String(run).padStart(8, '0')}`;
}

function row(
  stream: string,
  position: number,
  data: { readonly type: string; readonly [field: string]: unknown },
): Row {
  return { stream, position, type: data.type, data: JSON.stringify(data) };
}

function finishOf(run: number, at: string): readonly Row[] {
  const status = statusOf(run);
  const facts: Readonly<Record<string, object>> = {
    failed: {},
    rejected: { rejection: { reason: 'unavailable', detail: 'try again later' } },
    deferred: { record: {} },
    succeeded: { output: { text: text(run % largeEvery === 13 ? 1_048_576 : 640) }, record: {} },
  };
  const finished = { type: `execution_${status}`, ...facts[status], by: 'user-1', at };
  return run < 0 || status === 'running' ? [] : [row(executions(run), 2, finished)];
}

export function tick(t: number): readonly Row[] {
  const at = timeOf(t);
  const input = { text: text(t % largeEvery === 13 ? 262_144 : 320) };
  const start = { type: 'execution_started', primitive: 'inference', name: `spec-${t % 50}`, spec_version: 1, input };
  const inputs = Array.from({ length: t % 10 === 0 ? 20 : 0 }, (_, index) =>
    row(`brain/o1/big/runs/${String(t).padStart(8, '0')}`, index + 1, { type: 'input_applied', patch: text(2048) }),
  );
  const others = Array.from({ length: 7 }, (_, index) =>
    row(`brain/o2/other-${t % 99}/executions/${t}-${index}`, 1, { type: 'execution_started', input: text(512) }),
  );
  const started = row(executions(t), 1, { ...start, by: 'user-1', at });
  const longStart = t === 0 ? [{ ...started, stream: 'brain/o1/big/executions/long-running' }] : [];
  return [
    started,
    ...finishOf(t - 1, at),
    ...inputs,
    ...others,
    ...longStart,
    row(longRun, t + 1, { type: 'input_applied' }),
  ];
}
