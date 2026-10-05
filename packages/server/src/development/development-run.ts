import type { Environment } from '@beonauto/config';

import type { ChildCommand, RunningChild, StartChild } from './children.ts';
import type { RunnerLog } from './runner-log.ts';

export interface DevelopmentSetup {
  readonly envFiles: readonly string[];
  readonly sourceDirectories: readonly string[];
  readonly serverEntry: string;
  readonly configFile: string;
  readonly startChild: StartChild;
}

export interface DevelopmentRun {
  readonly setup: DevelopmentSetup;
  readonly execPath: string;
  readonly environment: Environment;
  readonly settings: Environment;
  readonly log: RunnerLog;
  readonly stopRequested: Promise<'stop'>;
  readonly start: (command: ChildCommand) => RunningChild;
}
