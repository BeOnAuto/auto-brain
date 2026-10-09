import { compileProgram, type Json, type ProgramLimits, type ProgramRun } from '@beonauto/workflow-engine/dsl';

import { computationDialect } from '../src/document/program-dialect.ts';

export function millisecondsOf(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

export function median(samples: readonly number[]): number {
  return samples.toSorted((first, second) => first - second)[Math.floor(samples.length / 2)] ?? 0;
}

export function runInThread(source: string, input: Json, limits: ProgramLimits): ProgramRun {
  const compiled = compileProgram(source, computationDialect);
  if ('issues' in compiled) {
    throw new Error(compiled.issues.map(({ detail }) => detail).join('; '));
  }
  return compiled.program.run(input, { limits, outputs: 'exactly one' });
}

export function formatted(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}
