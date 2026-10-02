import { whatAnswersOn } from '../development/temporal-answer.ts';
import {
  developmentFiles,
  localTemporalPorts,
  pidsOf,
  runnerLines,
  startDevelopment,
  untilGone,
  untilListening,
  type Development,
} from './development-process.ts';

export interface Ending {
  readonly exitCode: unknown;
  readonly alive: readonly number[];
  readonly temporal: string;
  readonly said: readonly string[];
}

const startedFirst = { temporal: 0, server: 2 };

export async function runningWithTemporal(): Promise<Development> {
  const development = startDevelopment(developmentFiles(), { temporal: await localTemporalPorts() });
  await untilListening(development);
  return development;
}

export function temporalAddressOf(development: Development): string {
  return String(/running on (127\.0\.0\.1:\d+)/u.exec(runnerLines(development).join('\n'))?.[1]);
}

export function pidOf(development: Development, child: keyof typeof startedFirst): number {
  return Number(pidsOf(development).at(startedFirst[child]));
}

export async function endingOf(development: Development): Promise<Ending> {
  const exitCode = await development.exited;
  return {
    exitCode,
    alive: await untilGone(development),
    temporal: await whatAnswersOn(temporalAddressOf(development)),
    said: runnerLines(development).slice(1),
  };
}
