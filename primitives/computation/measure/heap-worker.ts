import { getHeapStatistics } from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';

import { compileProgram, liftedLimits } from '@beonauto/workflow-engine/dsl';

const compiled = compileProgram(String(workerData), { refused: [] });

const ran =
  'program' in compiled
    ? compiled.program.run(null, { limits: liftedLimits(64_000_000), outputs: 'exactly one' }).ran
    : 'refused';

parentPort?.postMessage({ ran, heap: getHeapStatistics().total_heap_size }, []);
