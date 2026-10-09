import { mostInputBytes } from '@beonauto/definitions';
import { jsonBytesOf } from '@beonauto/workflow-engine/dsl';
import { Result } from 'effect';

import { parseComputationDocument } from '../src/document/document-parsing.ts';
import { computationLimits } from '../src/run/run-bounds.ts';
import { campaignPace, campaignRows } from '../src/testing/campaign-pace.ts';
import { formatted, median, millisecondsOf, runInThread } from './common.ts';

function program(): string {
  return Result.getOrThrow(parseComputationDocument(campaignPace)).program;
}

function mostRowsWithinTheInput(): number {
  let low = 1;
  let high = 100_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytesOf(campaignRows(middle)) <= mostInputBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function workOf(source: string, rows: number): number {
  return runInThread(source, campaignRows(rows), computationLimits).work;
}

export function exampleMeasured(): readonly string[] {
  const source = program();
  const most = mostRowsWithinTheInput();
  const perThousand = [1000, 2000, 4000].map(
    (rows) => `${formatted(workOf(source, rows))} units for ${formatted(rows)} rows`,
  );
  const input = campaignRows(most);
  const time = median(
    Array.from({ length: 9 }, () =>
      millisecondsOf(() => {
        runInThread(source, input, computationLimits);
      }),
    ),
  );
  return [
    `the example: ${perThousand.join(', ')}`,
    `the example at the most rows its input takes, ${formatted(most)} rows of ${formatted(jsonBytesOf(campaignRows(most)))} bytes: ${formatted(workOf(source, most))} units, ${formatted(time, 1)} ms at the median, on the thread that measures`,
  ];
}
