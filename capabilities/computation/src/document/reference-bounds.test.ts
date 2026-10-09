import { readFileSync } from 'node:fs';

import { mostSyntaxDepth } from '@beonauto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { computationBounds, mostOutputBytes } from '../run/run-bounds.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the bounds on the public reference page of computation functions', () => {
  it('are the bounds the code holds a program and a run to', () => {
    expect([
      valueOf('Nesting of the program'),
      valueOf('Work'),
      valueOf('Depth of a value'),
      valueOf('Recursion'),
      valueOf('Output'),
      valueOf('Duration'),
      valueOf('Memory'),
      valueOf('Runs at once'),
    ]).toEqual([
      expect.stringContaining(`${mostSyntaxDepth} levels`),
      expect.stringContaining(`${counted.format(computationBounds.mostWork)} units`),
      expect.stringContaining(`${computationBounds.mostValueDepth} levels`),
      expect.stringContaining(`${counted.format(computationBounds.mostEvaluationDepth)} levels of evaluation`),
      expect.stringContaining(`${counted.format(mostOutputBytes)} bytes`),
      expect.stringContaining(`${computationBounds.deadlineMs / 1000} seconds`),
      expect.stringContaining(`${computationBounds.heapMegabytes} MiB`),
      expect.stringContaining(`${computationBounds.workers} by default`),
    ]);
  });
});
