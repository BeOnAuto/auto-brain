import {
  developmentFiles,
  runnerLines,
  startDevelopment,
  untilGone,
  untilListening,
  type Development,
} from './development-process.ts';

export interface Stopped {
  readonly exitCode: unknown;
  readonly said: readonly string[];
}

export interface Ending extends Stopped {
  readonly allStopped: boolean;
}

export async function runningDevelopment(): Promise<Development> {
  const development = startDevelopment(developmentFiles());
  await untilListening(development);
  return development;
}

export async function stoppedWith(development: Development, signal: NodeJS.Signals): Promise<Stopped> {
  development.signal(signal);
  return { exitCode: await development.exited, said: runnerLines(development) };
}

export async function endingOf(development: Development): Promise<Ending> {
  const exitCode = await development.exited;
  return { exitCode, allStopped: await untilGone(development), said: runnerLines(development) };
}
