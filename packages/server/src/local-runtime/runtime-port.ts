import type { Environment } from '@on.auto/config';

import { localSettings } from '../command-line/local-settings.ts';
import { runtimeHomeIn } from './local-control.ts';

export const defaultRuntimePort = 5555;

const largestPort = 65_535;

function isPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= largestPort;
}

export function runtimePortOf(environment: Environment, home: string): number {
  const port = Number(localSettings(environment, { directory: runtimeHomeIn(home), home })['PORT'] ?? Number.NaN);
  return isPort(port) ? port : defaultRuntimePort;
}
