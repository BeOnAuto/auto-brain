import { appendFileSync } from 'node:fs';

import { Schema } from 'effect';

import { startChild, type StartChild } from '../development/children.ts';
import { runDevelopment } from '../development/development.ts';

const TestSetupSchema = Schema.Struct({
  envFiles: Schema.Array(Schema.String),
  sourceDirectory: Schema.String,
  serverEntry: Schema.String,
  configFile: Schema.String,
  pidsFile: Schema.String,
});

function recordingPidsIn(pidsFile: string): StartChild {
  return (command) => {
    const child = startChild(command);
    appendFileSync(pidsFile, `${JSON.stringify({ pid: child.pid })}\n`);
    return child;
  };
}

const setup = Schema.decodeUnknownSync(Schema.fromJsonString(TestSetupSchema))(process.argv[2]);

process.exitCode = await runDevelopment(process, {
  envFiles: setup.envFiles,
  sourceDirectories: [setup.sourceDirectory],
  serverEntry: setup.serverEntry,
  configFile: setup.configFile,
  startChild: recordingPidsIn(setup.pidsFile),
});
