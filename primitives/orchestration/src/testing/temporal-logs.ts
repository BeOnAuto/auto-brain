import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { Runtime } from '@temporalio/worker';

import { installTemporalRuntime, type TemporalLogEntry } from '../worker/temporal-runtime.ts';

const temporalLogs: TemporalLogEntry[] = [];

installTemporalRuntime((entry) => {
  temporalLogs.push(entry);
});

async function until(satisfied: () => boolean): Promise<void> {
  if (!satisfied()) {
    await setTimeout(20);
    await until(satisfied);
  }
}

export function temporalLogsSoFar(): readonly TemporalLogEntry[] {
  return temporalLogs;
}

export async function temporalLogsOf(workflowId: string): Promise<readonly TemporalLogEntry[]> {
  const flushed = `flushed ${randomUUID()}`;
  Runtime.instance().logger.error(flushed);
  await until(() => temporalLogs.some(({ message }) => message === `Temporal reported: ${flushed}`));
  return temporalLogs.filter(({ context }) => context['workflowId'] === workflowId);
}
