import { stopInsistedBy, stopRequestedBy } from './stop-request.ts';

const stopRequested = stopRequestedBy(process);
const stopInsisted = stopInsistedBy(process);
const { compositionRoot } = await import('./composition-root.ts');
const { runServer, exitOnStartupFailure } = await import('./run-server.ts');
await runServer(process, compositionRoot, stopRequested, stopInsisted).catch(exitOnStartupFailure(process));
