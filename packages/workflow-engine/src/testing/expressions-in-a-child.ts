import { spawnSync } from 'node:child_process';

import { Schema } from 'effect';

import type { Json } from '../dsl/json.ts';

export interface ChildEnding {
  readonly status: number | null;
  readonly signal: string | null;
}

export interface ChildEvaluation {
  readonly ended: ChildEnding;
  readonly output: string;
}

export const childTimeoutMs = 5000;

export const childHeapMegabytes = 256;

const evaluating = [
  `import { runExpression } from ${JSON.stringify(new URL('../dsl/expressions.ts', import.meta.url).href)};`,
  'const [source, data, mostWork] = process.argv.slice(1);',
  'const evaluation = runExpression(source, JSON.parse(data), {}, { now: 0, mostWork: Number(mostWork) });',
  'const peakMegabytes = process.resourceUsage().maxRSS / 1024;',
  'process.stdout.write(JSON.stringify({ ...evaluation, peakMegabytes }));',
].join('\n');

const StoppedEvaluationSchema = Schema.Struct({
  problem: Schema.String,
  work: Schema.Number,
  exhausted: Schema.Boolean,
  peakMegabytes: Schema.Number,
});

export const stoppedEvaluationOf = Schema.decodeUnknownSync(Schema.fromJsonString(StoppedEvaluationSchema));

export function evaluateInAChild(source: string, data: Json, mostWork: number): ChildEvaluation {
  const child = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${childHeapMegabytes}`,
      '--input-type=module',
      '--eval',
      evaluating,
      '--',
      source,
      JSON.stringify(data),
      String(mostWork),
    ],
    { encoding: 'utf8', timeout: childTimeoutMs, env: {} },
  );
  return { ended: { status: child.status, signal: child.signal }, output: child.stdout };
}
