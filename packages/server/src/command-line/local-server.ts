import { resolve } from 'node:path';

import type { Environment } from '@on.auto/config';
import { Effect } from 'effect';

import { release } from '../composition/release.ts';
import type { ColorDepth } from '../logging/terminal.ts';
import { configuredProviders } from '../settings/configured-providers.ts';
import { readLedgerSettings } from '../settings/ledger-settings.ts';
import { headerOf, readyNoticeOf, stoppedNotice, stoppingNotice } from './local-banner.ts';

interface LocalServer {
  readonly port: number;
  stop(): Promise<void>;
}

export interface LocalServerHost {
  readonly settings: Environment;
  readonly home: string;
  readonly depth: ColorDepth;
  readonly write: (text: string) => void;
  readonly clock: () => number;
  readonly run: () => Promise<LocalServer>;
  readonly stopRequested: Promise<void>;
}

const privateMemory = ':memory:';

function nearHome(file: string, home: string): string {
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

function ledgerOf(settings: Environment, home: string): string {
  const ledger = Effect.runSync(readLedgerSettings(settings));
  if (ledger.store === 'postgresql') {
    return `PostgreSQL, the database ${ledger.database} on ${ledger.host}`;
  }
  return ledger.file === privateMemory ? 'in memory, for this run only' : nearHome(resolve(ledger.file), home);
}

export async function servedLocally(host: LocalServerHost): Promise<void> {
  const startedAt = host.clock();
  host.write(headerOf(release.version, host.depth));
  const server = await host.run();
  host.write(
    readyNoticeOf(
      {
        url: `http://localhost:${server.port}`,
        readyInMs: Math.round(host.clock() - startedAt),
        providers: configuredProviders(host.settings),
        ledger: ledgerOf(host.settings, host.home),
      },
      host.depth,
    ),
  );
  await host.stopRequested;
  host.write(stoppingNotice(host.depth));
  await server.stop();
  host.write(stoppedNotice(host.depth));
}
