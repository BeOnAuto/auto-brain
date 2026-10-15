import type { RuntimeAction, StartedBy } from '@on.auto/api';
import { Function } from 'effect';

import { coalescedSignals } from '../command-line/coalesced-signals.ts';
import { servedLocally, type LocalServerHost } from '../command-line/local-server.ts';
import { release } from '../composition/release.ts';
import { stopInsistedBy, stopRequestedBy } from '../lifecycle/stop-request.ts';
import { isControlledAt, localControlOf, providerSetupFor, runtimeStatusOf } from './local-control.ts';

const signalsOfOneStop = 1000;

const serverProcess = {
  env: process.env,
  stdout: { write: () => true },
  stderr: process.stderr,
  exit: (code: number) => process.exit(code),
};

type LocalTerminal = Pick<LocalServerHost, 'depth' | 'write' | 'clock' | 'tickEvery'>;

export interface LocalStart {
  readonly home: string;
  readonly terminal: LocalTerminal;
}

export async function startedLocally(
  settings: Readonly<Record<string, string>>,
  startedBy: StartedBy,
  { home, terminal }: LocalStart,
): Promise<RuntimeAction> {
  const signals = coalescedSignals(process, signalsOfOneStop, () => performance.now());
  const local = localControlOf(
    runtimeStatusOf({
      version: release.version,
      pid: process.pid,
      startedAt: new Date(),
      directory: process.cwd(),
      home,
      startedBy,
    }),
  );
  const asked = Promise.race([stopRequestedBy(signals).then((): RuntimeAction => 'stop'), local.asked]);
  const stopRequested = asked.then(Function.constVoid);
  const stopInsisted = stopInsistedBy(signals);
  const control = isControlledAt(settings['HOST']) ? { runtimeControl: local.control } : {};
  const providerSetup = providerSetupFor(process.cwd(), settings['PORT']);
  Object.assign(process.env, settings);
  await servedLocally({
    ...terminal,
    run: async () => {
      const { compositionRoot } = await import('../composition/composition-root.ts');
      const { runServer } = await import('../lifecycle/run-server.ts');
      return runServer(serverProcess, { ...compositionRoot, ...control, providerSetup }, stopRequested, stopInsisted);
    },
    stopRequested,
  }).catch(async (failure: unknown) => {
    const { exitOnStartupFailure } = await import('../lifecycle/run-server.ts');
    exitOnStartupFailure(serverProcess)(failure);
  });
  return asked;
}
