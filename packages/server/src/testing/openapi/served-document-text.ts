import { openApiPath } from '@on.auto/api';

import { compositionRoot } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';

export async function servedDocumentText(): Promise<string> {
  const ledger = temporaryLedger();
  try {
    const server = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LOCAL_MODE: 'true',
        LOG_LEVEL: 'error',
        LEDGER_FILE: ledger.fileName,
        PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      },
      compositionRoot,
    );
    try {
      return await (await fetch(`http://127.0.0.1:${server.port}${openApiPath}`)).text();
    } finally {
      await server.stop();
    }
  } finally {
    ledger.remove();
  }
}
