import { setTimeout as delay } from 'node:timers/promises';

import {
  parseJSONRPCMessage,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type FetchLike,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/client';
import { Redacted } from 'effect';

import type { HttpServerSettings } from '../settings/mcp-settings.ts';
import { ignored } from './ignored.ts';
import { connectionOver, observingFetch, openingClient, type McpConnection } from './mcp-connection.ts';
import type { Observations } from './observed-requests.ts';
import { failureOf } from './server-failures.ts';

export interface Timer {
  readonly after: (ms: number, expire: () => void) => () => void;
}

export const systemTimer: Timer = {
  after: (ms, expire) => {
    const timeout = setTimeout(expire, ms);
    return () => {
      clearTimeout(timeout);
    };
  },
};

export interface HttpOpening {
  readonly fetch: FetchLike;
  readonly authProvider: AuthProvider | undefined;
  readonly timeoutMs: number;
  readonly longestRetryWaitMs: number;
  readonly reportError: (message: string) => void;
  readonly timer: Timer;
}

interface Limited {
  readonly failure: unknown;
  readonly retryAfterMs: number | null;
}

function headersOf({ headers }: HttpServerSettings): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

type SendOptions = Parameters<StreamableHTTPClientTransport['send']>[1];

function transportOptions(
  settings: HttpServerSettings,
  opening: HttpOpening,
  observed: Observations,
): StreamableHTTPClientTransportOptions {
  return {
    requestInit: { headers: headersOf(settings) },
    fetch: observingFetch(opening.fetch, observed),
    ...(opening.authProvider === undefined ? {} : { authProvider: opening.authProvider }),
  };
}

class ObservedHttpTransport extends StreamableHTTPClientTransport {
  readonly #observations: Observations;

  constructor(settings: HttpServerSettings, opening: HttpOpening, observed: Observations) {
    super(new URL(settings.url), transportOptions(settings, opening, observed));
    this.#observations = observed;
  }

  override send(message: unknown, options?: Readonly<SendOptions>): Promise<void> {
    this.#observations.noteSent(message, options);
    return super.send(parseJSONRPCMessage(message), options);
  }
}

async function connectedOnce(settings: HttpServerSettings, opening: HttpOpening): Promise<McpConnection | Limited> {
  const opened = openingClient(settings.request_id, opening.reportError);
  const transport = new ObservedHttpTransport(settings, opening, opened.observations);
  try {
    await opened.client.connect(transport, { timeout: opening.timeoutMs });
  } catch (failure) {
    await opened.client.close();
    if (failureOf(failure).kind === 'rate_limited') {
      return { failure, retryAfterMs: opened.observations.lastRetryAfterMs() };
    }
    throw failure;
  }
  return connectionOver(opened.client, opened.observations, opened.closed, async () => {
    const expired = Promise.withResolvers<void>();
    const stopWaiting = opening.timer.after(opening.timeoutMs, expired.resolve);
    try {
      await Promise.race([transport.terminateSession().catch(ignored), expired.promise]);
    } finally {
      stopWaiting();
      await opened.client.close();
    }
  });
}

function isLimited(opened: McpConnection | Limited): opened is Limited {
  return 'failure' in opened;
}

export async function openHttp(settings: HttpServerSettings, opening: HttpOpening): Promise<McpConnection> {
  const first = await connectedOnce(settings, opening);
  if (!isLimited(first)) {
    return first;
  }
  const { failure, retryAfterMs } = first;
  if (retryAfterMs === null || retryAfterMs > opening.longestRetryWaitMs) {
    throw failure;
  }
  await delay(retryAfterMs);
  const second = await connectedOnce(settings, opening);
  if (isLimited(second)) {
    throw second.failure;
  }
  return second;
}
