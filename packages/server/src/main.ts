import { stopRequestedBy } from './stop-request.ts';

const stopRequested = stopRequestedBy(process);
const { compositionRoot } = await import('./composition-root.ts');
const { runServer } = await import('./run-server.ts');
await runServer(process, compositionRoot, stopRequested);
