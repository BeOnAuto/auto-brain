import { isLocalHost } from '../middleware/validate-host.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

export type StartedBy = 'terminal' | 'agent';

export interface RuntimeStatus {
  readonly version: string;
  readonly pid: number;
  readonly startedAt: Date;
  readonly directory: string;
  readonly startedBy: StartedBy;
  readonly logFile: string | undefined;
}

export interface RuntimeControl {
  readonly status: () => RuntimeStatus;
  readonly stop: () => void;
  readonly restart: () => void;
}

export type RuntimeAction = 'stop' | 'restart';

export const runtimePath = '/runtime';

export const runtimeActionPaths: Readonly<Record<RuntimeAction, string>> = {
  stop: `${runtimePath}/stop`,
  restart: `${runtimePath}/restart`,
};

const notFromThisComputer = problemOf('forbidden', 'Only this computer can control Auto Runtime');

const notFromItsPage = problemOf('origin_not_allowed', 'Only the page of this server can control Auto Runtime');

interface Asker {
  readonly host: string;
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
}

function isFromItsPage({ host, origin, fetchSite }: Asker): boolean {
  if (origin === 'null') {
    return fetchSite === 'same-origin';
  }
  return origin === undefined || origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

export function refusalOf(asker: Asker): Response | undefined {
  if (!isLocalHost(asker.host)) {
    return problemResponse(notFromThisComputer);
  }
  return isFromItsPage(asker) ? undefined : problemResponse(notFromItsPage);
}

export function statusDocumentOf(status: RuntimeStatus): Readonly<Record<string, string | number>> {
  return {
    version: status.version,
    pid: status.pid,
    started_at: status.startedAt.toISOString(),
    started_by: status.startedBy,
    directory: status.directory,
    ...(status.logFile === undefined ? {} : { log_file: status.logFile }),
  };
}

export function act(control: RuntimeControl, action: RuntimeAction): void {
  if (action === 'stop') {
    control.stop();
  } else {
    control.restart();
  }
}
