import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export type CandidateName =
  | 'visits-last'
  | 'visits-wide'
  | 'visits-narrow'
  | 'visits-even'
  | 'visits-mean'
  | 'visits-observed-mean'
  | 'visits-week'
  | 'visits-many-features'
  | 'visits-steady'
  | 'visits-not-a-number'
  | 'visits-extra-input'
  | 'visits-opset-12'
  | 'visits-whole-numbers'
  | 'visits-allocating'
  | 'visits-hostile'
  | 'visits-sequence'
  | 'orders-last'
  | 'totals-run-rate'
  | 'not-a-model';

export function candidateUrl(name: CandidateName): URL {
  return new URL(`../../candidates/${name}.onnx`, import.meta.url);
}

export function candidateBytes(name: CandidateName): Readonly<Uint8Array> {
  return readFileSync(candidateUrl(name));
}

export function candidateSha256(name: CandidateName): string {
  return createHash('sha256').update(candidateBytes(name)).digest('hex');
}

export function performedOnce(works: readonly DueWork[], now: number): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let performed = 0;
      for (const work of works) {
        const items = [...(yield* work.due(now, 256, true)), ...(yield* work.due(now, 256, false))];
        for (const item of items) {
          yield* item.perform(now);
          performed += 1;
        }
      }
      return performed;
    }).pipe(Effect.orDie),
  );
}

async function performedFrom(works: readonly DueWork[], ahead: number, roundsLeft: number): Promise<number> {
  const performed = await performedOnce(works, Date.now() + ahead);
  return performed === 0 || roundsLeft <= 1
    ? performed
    : performed + (await performedFrom(works, ahead, roundsLeft - 1));
}

export function performedUntilQuiet(works: readonly DueWork[], ahead = 1000, most = 64): Promise<number> {
  return performedFrom(works, ahead, most);
}
