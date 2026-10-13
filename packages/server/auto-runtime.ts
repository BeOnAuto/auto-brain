import { homedir } from 'node:os';

import { coalescedSignals } from './src/command-line/coalesced-signals.ts';
import { runCommandLine } from './src/command-line/command-line.ts';
import { servedLocally } from './src/command-line/local-server.ts';
import { stopInsistedBy, stopRequestedBy } from './src/lifecycle/stop-request.ts';
import { colorDepthOf } from './src/logging/terminal.ts';

const signalsOfOneStop = 1000;

const serverProcess = {
  env: process.env,
  stdout: { write: () => true },
  stderr: process.stderr,
  exit: (code: number) => process.exit(code),
};

async function startServer(settings: Readonly<Record<string, string>>): Promise<void> {
  const signals = coalescedSignals(process, signalsOfOneStop, () => performance.now());
  const stopRequested = stopRequestedBy(signals);
  const stopInsisted = stopInsistedBy(signals);
  Object.assign(process.env, settings);
  await servedLocally({
    settings: process.env,
    home: homedir(),
    depth: colorDepthOf(process.stdout),
    write: (text) => {
      process.stdout.write(text);
    },
    clock: () => performance.now(),
    run: async () => {
      const { compositionRoot } = await import('./src/composition/composition-root.ts');
      const { runServer } = await import('./src/lifecycle/run-server.ts');
      return runServer(serverProcess, compositionRoot, stopRequested, stopInsisted);
    },
    stopRequested,
  }).catch(async (failure: unknown) => {
    const { exitOnStartupFailure } = await import('./src/lifecycle/run-server.ts');
    exitOnStartupFailure(serverProcess)(failure);
  });
}

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
    startServer,
  })) ?? process.exitCode;
