import { computationBounds, makeComputationFunctionAdapter } from '@beonauto/computation';
import type { Primitive } from '@beonauto/specs';
import { programPool, type ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { Served } from '../lifecycle/lifecycle.ts';
import type { ComputationSettings } from '../settings/computation-settings.ts';

export type ProgramPoolOf = (settings: ComputationSettings) => ProgramPool;

export interface ServedComputation {
  readonly primitive: Primitive;
  readonly pool: ProgramPool;
  readonly withPoolClosed: (served: Served) => Served;
}

export const workerPool: ProgramPoolOf = ({ workers }) =>
  programPool({ workers, heapMegabytes: computationBounds.heapMegabytes });

export function computationServedBy(settings: ComputationSettings, poolOf: ProgramPoolOf): ServedComputation {
  const pool = poolOf(settings);
  return {
    primitive: makeComputationFunctionAdapter({ pool }),
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
