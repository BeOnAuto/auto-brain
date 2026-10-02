import type { Environment } from '@beonauto/config';

import type { ChildCommand, RunningChild, StartChild } from './children.ts';

export interface LocalTemporal {
  readonly port: number;
  readonly uiPort: number;
  readonly stateFile: string;
}

export interface DevelopmentSetup {
  readonly envFiles: readonly string[];
  readonly sourceDirectories: readonly string[];
  readonly serverEntry: string;
  readonly temporal: LocalTemporal | undefined;
  readonly obtainCli: (announce: (message: string) => void) => Promise<string>;
  readonly startChild: StartChild;
}

export interface DevelopmentRun {
  readonly setup: DevelopmentSetup;
  readonly execPath: string;
  readonly environment: Environment;
  readonly settings: Environment;
  readonly say: (message: string) => void;
  readonly stopRequested: Promise<'stop'>;
  readonly start: (command: ChildCommand) => RunningChild;
}
