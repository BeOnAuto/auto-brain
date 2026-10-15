import { fileURLToPath } from 'node:url';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Environment } from '@on.auto/config';

import { release } from '../composition/release.ts';
import { startInBackgroundOf, startingLockIn } from './background-process.ts';
import { impatient, runningRuntime, throughARestart } from './background-start.ts';
import { logFileIn } from './local-control.ts';
import { relay } from './mcp-relay.ts';
import { runtimeAddressOf, type Waiting } from './runtime-probe.ts';

export interface AgentRelaying {
  readonly home: string;
  readonly environment: Environment;
  readonly waiting: Waiting;
}

function report(line: string): void {
  process.stderr.write(`${line}\n`);
}

export async function relayedAgent(port: number, { home, environment, waiting }: AgentRelaying): Promise<void> {
  const starting = {
    ...waiting,
    version: release.version,
    logFile: logFileIn(home),
    startingLock: startingLockIn(home),
    startInBackground: startInBackgroundOf({
      execPath: process.execPath,
      execArgv: process.execArgv,
      entry: fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url)),
      home,
      environment,
      report,
    }),
  };
  const notRunning = await runningRuntime(port, starting, impatient);
  if (notRunning !== undefined) {
    report(notRunning);
  }
  await relay({
    agent: () => new StdioServerTransport(),
    runtime: () => new StreamableHTTPClientTransport(new URL(`${runtimeAddressOf(port)}/mcp`)),
    recover: () => runningRuntime(port, starting, throughARestart),
    report,
  });
}
