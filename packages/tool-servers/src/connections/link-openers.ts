import type { FetchLike } from '@modelcontextprotocol/client';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { apiConnection } from '../openapi/api-connection.ts';
import type { DescribedApiSettings, LinkedServerSettings } from '../openapi/described-api.ts';
import { openHttp, systemTimer, type Timer } from './http-connection.ts';
import { boundedReport, errorsNoLongerReported, type ClientInfo, type OutputReport } from './mcp-connection.ts';
import { openStdio } from './stdio-connection.ts';
import { tokenSource, type Discovery, type TokenSource } from './token-source.ts';

export interface LinkOptions {
  readonly client: ClientInfo;
  readonly fetch: FetchLike;
  readonly secrets: Secrets;
  readonly now: () => number;
  readonly timer?: Timer;
  readonly timing: Timing;
  readonly reportOutput: (server: string, line: string) => void;
}

interface Remote {
  readonly auth: DescribedApiSettings['auth'];
  readonly serverUrl: string;
  readonly discovery: Discovery;
}

function tokensOf({ auth, serverUrl, discovery }: Remote, options: LinkOptions): TokenSource | undefined {
  return auth === null
    ? undefined
    : tokenSource(auth, { serverUrl, discovery, fetch: options.fetch, now: options.now, minted: options.secrets.add });
}

export function openerOf(settings: LinkedServerSettings, options: LinkOptions) {
  const output: OutputReport = {
    scrub: options.secrets.scrub,
    report: (line) => {
      options.reportOutput(settings.name, line);
    },
  };
  if (settings.type === 'stdio') {
    return () => openStdio(settings, { client: options.client, timeoutMs: options.timing.openMs, output });
  }
  if (settings.type === 'openapi') {
    const tokens = tokensOf(
      { auth: settings.auth, serverUrl: settings.api.baseUrl, discovery: 'from_the_issuer' },
      options,
    );
    return () => Promise.resolve(apiConnection(settings, { fetch: options.fetch, tokens, now: options.now }));
  }
  const authProvider = tokensOf(
    { auth: settings.auth, serverUrl: settings.url, discovery: 'from_the_server' },
    options,
  );
  const { openMs, longestRetryWaitMs } = options.timing;
  return () =>
    openHttp(settings, {
      client: options.client,
      fetch: options.fetch,
      authProvider,
      timeoutMs: openMs,
      longestRetryWaitMs,
      reportError: boundedReport(output, errorsNoLongerReported),
      timer: options.timer ?? systemTimer,
    });
}
