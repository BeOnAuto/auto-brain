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
  'const [source, data, mostWork, milliseconds] = process.argv.slice(1);',
  'const clock = () => performance.now();',
  'const deadline = milliseconds === undefined ? {} : { deadline: { milliseconds: Number(milliseconds), clock } };',
  'const started = clock();',
  'const evaluation = runExpression(source, JSON.parse(data), {}, { now: 0, mostWork: Number(mostWork), ...deadline });',
  'const elapsed = clock() - started;',
  'const peakMegabytes = process.resourceUsage().maxRSS / 1024;',
  'process.stdout.write(JSON.stringify({ ...evaluation, elapsed, peakMegabytes }));',
].join('\n');

const StoppedEvaluationSchema = Schema.Struct({
  problem: Schema.String,
  work: Schema.Number,
  exhausted: Schema.Boolean,
  limit: Schema.optionalKey(Schema.Literals(['work', 'deadline'])),
  elapsed: Schema.Number,
  peakMegabytes: Schema.Number,
});

export const stoppedEvaluationOf = Schema.decodeUnknownSync(Schema.fromJsonString(StoppedEvaluationSchema));

function evaluated(given: readonly string[]): ChildEvaluation {
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${childHeapMegabytes}`, '--input-type=module', '--eval', evaluating, '--', ...given],
    { encoding: 'utf8', timeout: childTimeoutMs, env: {} },
  );
  return { ended: { status: child.status, signal: child.signal }, output: child.stdout };
}

export function evaluateInAChild(source: string, data: Json, mostWork: number): ChildEvaluation {
  return evaluated([source, JSON.stringify(data), String(mostWork)]);
}

export function evaluateInAChildWithin(source: string, mostWork: number, milliseconds: number): ChildEvaluation {
  return evaluated([source, 'null', String(mostWork), String(milliseconds)]);
}
