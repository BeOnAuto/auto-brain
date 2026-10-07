import { Buffer } from 'node:buffer';

import { Schema } from 'effect';

import { isUntrustedCertificate } from '../certificates/untrusted-certificates.ts';
import { outboundBounds } from './delivery-schedule.ts';

export type OutboundFetch = typeof globalThis.fetch;

export interface OutboundPost {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly fetch?: OutboundFetch;
  readonly timeoutMs?: number;
}

export type FailedBecause = 'status' | 'timed_out' | 'unreachable' | 'untrusted_certificate';

export type RefusedBecause = 'status' | 'redirected' | 'not_https' | 'too_large';

export type PostOutcome =
  | {
      readonly kind: 'delivered';
      readonly status: number;
      readonly body: string;
      readonly bytes: number;
      readonly cut: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly status: number | null;
      readonly because: FailedBecause;
      readonly retryAfterMs?: number;
    }
  | { readonly kind: 'refused'; readonly status: number | null; readonly because: RefusedBecause };

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

const retriedStatuses: ReadonlySet<number> = new Set([408, 429]);

const bytesOf = Schema.decodeUnknownSync(Schema.instanceOf(Uint8Array));

export function isDeliverableUrl(url: string): boolean {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname)))
  );
}

function retryAfterOf(response: Response, now: number): number | undefined {
  const written = response.headers.get('retry-after');
  if (written === null) {
    return undefined;
  }
  const seconds = Number(written);
  const at = Date.parse(written);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

async function bodyOf(
  response: Readonly<Response>,
): Promise<Omit<Extract<PostOutcome, { kind: 'delivered' }>, 'kind' | 'status'>> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    const piece = bytesOf(chunk);
    chunks.push(piece);
    bytes += piece.length;
    if (bytes > outboundBounds.responseBytes) {
      break;
    }
  }
  const kept = Buffer.concat(chunks).subarray(0, outboundBounds.responseBytes);
  const body = new TextDecoder().decode(kept, { stream: true });
  return { body, bytes, cut: bytes > outboundBounds.responseBytes };
}

async function outcomeOf(response: Response, now: number): Promise<PostOutcome> {
  const { status } = response;
  if (status >= 200 && status < 300) {
    return { kind: 'delivered', status, ...(await bodyOf(response)) };
  }
  await response.body?.cancel();
  if (status >= 300 && status < 400) {
    return { kind: 'refused', status, because: 'redirected' };
  }
  if (status >= 500 || retriedStatuses.has(status)) {
    const retryAfterMs = status === 429 ? retryAfterOf(response, now) : undefined;
    return { kind: 'failed', status, because: 'status', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
  return { kind: 'refused', status, because: 'status' };
}

function failureOf(error: unknown): PostOutcome {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { kind: 'failed', status: null, because: 'timed_out' };
  }
  return {
    kind: 'failed',
    status: null,
    because: isUntrustedCertificate(error) ? 'untrusted_certificate' : 'unreachable',
  };
}

export async function postedOutbound({
  url,
  headers,
  body,
  fetch = globalThis.fetch,
  timeoutMs = outboundBounds.callMs,
}: OutboundPost): Promise<PostOutcome> {
  if (!isDeliverableUrl(url)) {
    return { kind: 'refused', status: null, because: 'not_https' };
  }
  if (Buffer.byteLength(body, 'utf8') > outboundBounds.requestBytes) {
    return { kind: 'refused', status: null, because: 'too_large' };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await outcomeOf(response, Date.now());
  } catch (error) {
    return failureOf(error);
  }
}
