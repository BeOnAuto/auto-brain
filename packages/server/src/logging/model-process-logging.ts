import { Effect } from 'effect';

export interface ModelProcessesReport {
  readonly processes: number;
  readonly memoryMebibytes: number;
  readonly buildsAtOnce: number;
  readonly limiter: string | undefined;
}

const counted = new Intl.NumberFormat('en');

function boundOf({ limiter }: ModelProcessesReport): string {
  return limiter === undefined ? 'which nothing bounds, since prlimit is not on the path' : 'which prlimit bounds';
}

export function logModelProcesses(report: ModelProcessesReport): Effect.Effect<void> {
  const { processes, memoryMebibytes, buildsAtOnce, limiter } = report;
  return Effect.logInfo(
    `Model processes may run at most ${processes} at once, at most ${buildsAtOnce} of them for builds, with ${counted.format(memoryMebibytes)} MiB of data each, ${boundOf(report)}`,
  ).pipe(
    Effect.annotateLogs({
      model_processes: processes,
      model_process_memory_mib: memoryMebibytes,
      model_process_builds: buildsAtOnce,
      model_process_limiter: limiter ?? null,
    }),
  );
}
