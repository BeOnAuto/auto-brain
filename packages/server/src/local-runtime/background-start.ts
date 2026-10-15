import { askedTo, probeAt, waitedFor, type Probe, type Waiting } from './runtime-probe.ts';

export interface StartingLock {
  readonly take: () => boolean;
  readonly release: () => void;
}

export interface BackgroundStarting extends Waiting {
  readonly version: string;
  readonly startInBackground: () => void;
  readonly startingLock: StartingLock;
  readonly logFile: string;
}

export interface Patience {
  readonly attempts: number;
}

export const impatient: Patience = { attempts: 0 };

export const throughARestart: Patience = { attempts: 100 };

const stopAttempts = 150;

const startAttempts = 600;

function isNewer(version: string, than: string): boolean {
  return version.localeCompare(than, 'en', { numeric: true }) > 0;
}

function isOutdated(probe: Probe, version: string): boolean {
  return probe.state === 'running' && probe.status.started_by === 'agent' && isNewer(version, probe.status.version);
}

function isAnswering(probe: Probe): boolean {
  return probe.state === 'running' || probe.state === 'uncontrolled';
}

function isDown(probe: Probe): boolean {
  return probe.state === 'down';
}

async function startedHere(port: number, starting: BackgroundStarting): Promise<string | undefined> {
  const took = starting.startingLock.take();
  if (took) {
    starting.startInBackground();
  }
  try {
    return (await waitedFor(port, starting, startAttempts, isAnswering))
      ? undefined
      : `Auto Runtime did not start on port ${port}; its log is ${starting.logFile}`;
  } finally {
    if (took) {
      starting.startingLock.release();
    }
  }
}

async function replaced(port: number, starting: BackgroundStarting): Promise<string | undefined> {
  const stopped =
    (await askedTo('stop', port, starting.fetch)) && (await waitedFor(port, starting, stopAttempts, isDown));
  return stopped ? startedHere(port, starting) : undefined;
}

export async function runningRuntime(
  port: number,
  starting: BackgroundStarting,
  patience: Patience,
): Promise<string | undefined> {
  const probe = await probeAt(port, starting.fetch);
  if (isOutdated(probe, starting.version)) {
    return replaced(port, starting);
  }
  if (probe.state === 'foreign') {
    return `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`;
  }
  if (isAnswering(probe) || (await waitedFor(port, starting, patience.attempts, isAnswering))) {
    return undefined;
  }
  return startedHere(port, starting);
}
