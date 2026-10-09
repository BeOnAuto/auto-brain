import { computationBounds, makeComputationFunctionAdapter } from '@beonauto/computation';
import type { Capability } from '@beonauto/definitions';
import { programPool, type ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { ComputationSettings } from '../function-settings/computation-settings.ts';
import type { Served } from '../lifecycle/lifecycle.ts';

export type ProgramPoolOf = (settings: ComputationSettings) => ProgramPool;

export interface ServedComputation {
  readonly capability: Capability;
  readonly pool: ProgramPool;
  readonly withPoolClosed: (served: Served) => Served;
}

export const workerPool: ProgramPoolOf = ({ workers }) =>
  programPool({ workers, heapMegabytes: computationBounds.heapMegabytes });

export function computationServedBy(settings: ComputationSettings, poolOf: ProgramPoolOf): ServedComputation {
  const pool = poolOf(settings);
  return {
    capability: makeComputationFunctionAdapter({ pool }),
    pool,
    withPoolClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await pool.close();
      },
    }),
  };
}
