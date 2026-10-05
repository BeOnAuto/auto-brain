import { appendFileSync } from 'node:fs';

import { Schema } from 'effect';

import { startChild, type RunningChild, type StartChild } from '../development/children.ts';
import { runDevelopment } from '../development/development.ts';

const TestSetupSchema = Schema.Struct({
  envFiles: Schema.Array(Schema.String),
  sourceDirectory: Schema.String,
  serverEntry: Schema.String,
  configFile: Schema.String,
  pidsFile: Schema.String,
});

const servers: RunningChild[] = [];

function recordingPidsIn(pidsFile: string, serverEntry: string): StartChild {
  return (command) => {
    const child = startChild(command);
    appendFileSync(pidsFile, `${JSON.stringify({ pid: child.pid })}\n`);
    if (command.args.includes(serverEntry)) {
      servers.push(child);
    }
    return child;
  };
}

process.on('SIGUSR2', () => {
  for (const server of servers.slice(-1)) {
    server.signal('SIGKILL');
  }
});

const setup = Schema.decodeUnknownSync(Schema.fromJsonString(TestSetupSchema))(process.argv[2]);

process.exitCode = await runDevelopment(process, {
  envFiles: setup.envFiles,
  sourceDirectories: [setup.sourceDirectory],
  serverEntry: setup.serverEntry,
  configFile: setup.configFile,
  startChild: recordingPidsIn(setup.pidsFile, setup.serverEntry),
});
