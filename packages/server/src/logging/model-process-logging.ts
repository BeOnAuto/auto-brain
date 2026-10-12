import { Effect } from 'effect';

export interface ModelProcessesReport {
  readonly processes: number;
  readonly memoryMebibytes: number;
  readonly buildsAtOnce: number;
  readonly limiter: string | undefined;
}

const counted = new Intl.NumberFormat('en');

function memoryBoundOf({ memoryMebibytes, limiter }: ModelProcessesReport): string {
  return limiter === undefined
    ? 'their memory unbounded, since prlimit is not on the path'
    : `each bounded to ${counted.format(memoryMebibytes)} MiB of data by prlimit`;
}

export function logModelProcesses(report: ModelProcessesReport): Effect.Effect<void> {
  const { processes, memoryMebibytes, buildsAtOnce, limiter } = report;
  return Effect.logInfo(
    `Model processes run in this server: at most ${processes} at once, at most ${buildsAtOnce} of them for builds, ${memoryBoundOf(report)}`,
  ).pipe(
    Effect.annotateLogs({
      model_processes: processes,
      model_process_memory_mib: memoryMebibytes,
      model_process_builds: buildsAtOnce,
      model_process_limiter: limiter ?? null,
    }),
  );
}
