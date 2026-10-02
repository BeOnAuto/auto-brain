import { stopInsistedBy, stopRequestedBy } from './lifecycle/stop-request.ts';

const stopRequested = stopRequestedBy(process);
const stopInsisted = stopInsistedBy(process);
const { compositionRoot } = await import('./composition/composition-root.ts');
const { runServer, exitOnStartupFailure } = await import('./lifecycle/run-server.ts');
await runServer(process, compositionRoot, stopRequested, stopInsisted).catch(exitOnStartupFailure(process));
