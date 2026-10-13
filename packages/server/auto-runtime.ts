import { homedir } from 'node:os';

import { runCommandLine } from './src/command-line/command-line.ts';

process.exitCode =
  (await runCommandLine(process.argv.slice(2), {
    environment: process.env,
    place: { directory: process.cwd(), home: homedir() },
    console: {
      log: (line) => {
        process.stdout.write(`${line}\n`);
      },
      error: (line) => {
        process.stderr.write(`${line}\n`);
      },
    },
    startServer: (settings) => {
      Object.assign(process.env, settings);
      return import('./src/main.ts');
    },
  })) ?? process.exitCode;
