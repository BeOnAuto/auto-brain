import { computationBounds, makeComputationFunctionAdapter } from '@on.auto/computation';
import type { Capability } from '@on.auto/definitions';
import { checkedAtSave, warmedChecks } from '@on.auto/definitions/check';
import { programPool, type CheckJob, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { ComputationSettings } from '../function-settings/computation-settings.ts';
import type { Served } from '../lifecycle/lifecycle.ts';

export type ProgramPoolOf = (settings: ComputationSettings) => ProgramPool;

export interface ServedComputation {
  readonly capability: Capability;
  readonly pool: ProgramPool;
  readonly check: (job: CheckJob) => ReturnType<typeof checkedAtSave>;
  readonly withPoolClosed: (served: Served) => Served;
}

export const workerPool: ProgramPoolOf = ({ workers }) =>
  programPool({ workers, heapMegabytes: computationBounds.heapMegabytes });

export async function computationServedBy(
  settings: ComputationSettings,
  poolOf: ProgramPoolOf,
): Promise<ServedComputation> {
  const pool = poolOf(settings);
  await warmedChecks(pool);
  return {
    capability: makeComputationFunctionAdapter({ pool }),
    pool,
    check: (job) => checkedAtSave(pool, job),
    withPoolClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await pool.close();
      },
    }),
  };
}
