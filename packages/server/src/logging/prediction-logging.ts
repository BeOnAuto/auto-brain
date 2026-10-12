import { Effect } from 'effect';

export interface PredictionFunctionsReport {
  readonly mostFunctions: number;
  readonly processes: number;
  readonly memoryMebibytes: number;
  readonly buildsAtOnce: number;
  readonly limiter: string | undefined;
}

const counted = new Intl.NumberFormat('en');

function boundOf({ limiter }: PredictionFunctionsReport): string {
  return limiter === undefined ? 'which nothing bounds, since prlimit is not on the path' : 'which prlimit bounds';
}

export function logPredictionFunctions(report: PredictionFunctionsReport): Effect.Effect<void> {
  const { mostFunctions, processes, memoryMebibytes, buildsAtOnce, limiter } = report;
  return Effect.logInfo(
    `Prediction functions run in this server: a playbook keeps at most ${counted.format(mostFunctions)} active, and model processes may run at most ${processes} at once, at most ${buildsAtOnce} of them for builds, with ${counted.format(memoryMebibytes)} MiB of data each, ${boundOf(report)}`,
  ).pipe(
    Effect.annotateLogs({
      most_functions: mostFunctions,
      model_processes: processes,
      model_process_memory_mib: memoryMebibytes,
      model_process_builds: buildsAtOnce,
      model_process_limiter: limiter ?? null,
    }),
  );
}
