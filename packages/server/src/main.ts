import { stopRequestedBy } from './stop-request.ts';

const stopRequested = stopRequestedBy(process);
const { compositionRoot } = await import('./composition-root.ts');
const { runServer, exitOnStartupFailure } = await import('./run-server.ts');
await runServer(process, compositionRoot, stopRequested).catch(exitOnStartupFailure(process));
