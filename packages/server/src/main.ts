import { compositionRoot } from './composition-root.ts';
import { runServer } from './lifecycle.ts';

await runServer(process, compositionRoot);
