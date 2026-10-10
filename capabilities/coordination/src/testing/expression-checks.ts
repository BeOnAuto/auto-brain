import { checkedAtSave } from '@beonauto/definitions/check';
import { programPool, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import { afterAll } from 'vitest';

import type { ExpressionCheck } from '../document/expression-check.ts';

let pool: ProgramPool | undefined;

afterAll(async () => {
  await pool?.close();
  pool = undefined;
});

export const testExpressionCheck: ExpressionCheck = (job) => {
  pool ??= programPool({ workers: 1, heapMegabytes: 256 });
  return checkedAtSave(pool, job);
};
