import { once } from 'node:events';
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';

import { startChild, type StartChild } from '../development/children.ts';
import type { DevelopmentSetup } from '../development/development-run.ts';
import { runDevelopment } from '../development/development.ts';
import { obtainTemporalCli, pinnedTemporalCli } from '../development/temporal-cli.ts';

const TestSetupSchema = Schema.Struct({
  envFiles: Schema.Array(Schema.String),
  sourceDirectory: Schema.String,
  serverEntry: Schema.String,
  configFile: Schema.String,
  pidsFile: Schema.String,
  temporal: Schema.optional(Schema.Struct({ port: Schema.Number, uiPort: Schema.Number, stateFile: Schema.String })),
  obtain: Schema.Union([
    Schema.Literals(['cached', 'held until stopped']),
    Schema.Struct({ unobtainable: Schema.String }),
  ]),
});

type TestSetup = typeof TestSetupSchema.Type;

function recordingPidsIn(pidsFile: string): StartChild {
  return (command) => {
    const child = startChild(command);
    appendFileSync(pidsFile, `${JSON.stringify({ pid: child.pid })}\n`);
    return child;
  };
}

function obtainBy({ obtain }: TestSetup): DevelopmentSetup['obtainCli'] {
  if (obtain === 'cached') {
    return (announce) => obtainTemporalCli(announce, pinnedTemporalCli);
  }
  if (obtain === 'held until stopped') {
    return async (announce) => {
      announce('Holding the Temporal CLI until the runner is told to stop');
      const holding = new AbortController();
      const held = setTimeout(3_600_000, 'held', { signal: holding.signal }).catch(() => 'released');
      await once(process, 'SIGTERM');
      holding.abort();
      await held;
      return pinnedTemporalCli.path();
    };
  }
  return () => Promise.reject(new Error(obtain.unobtainable));
}

const setup = Schema.decodeUnknownSync(Schema.fromJsonString(TestSetupSchema))(process.argv[2]);

process.exitCode = await runDevelopment(process, {
  envFiles: setup.envFiles,
  sourceDirectories: [setup.sourceDirectory],
  serverEntry: setup.serverEntry,
  configFile: setup.configFile,
  temporal: setup.temporal,
  obtainCli: obtainBy(setup),
  startChild: recordingPidsIn(setup.pidsFile),
});
