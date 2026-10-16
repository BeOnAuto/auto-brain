import type { FetchLike } from '@modelcontextprotocol/client';
import { Predicate } from 'effect';

import { HostRefused } from '../connections/server-failures.ts';

export type Reaches = (url: string) => string | undefined;

const unfollowed = { redirect: 'manual' } as const;

function addressOf(input: unknown): string {
  return input instanceof Request ? input.url : String(input);
}

function requestFieldsOf(input: unknown): RequestInit {
  if (!(input instanceof Request)) {
    return {};
  }
  const { method, headers, signal, body } = input;
  return body === null ? { method, headers, signal } : { method, headers, signal, body, duplex: 'half' };
}

export function fetchWithin(fetch: FetchLike, reaches: Reaches): (input: unknown, init?: unknown) => Promise<Response> {
  return (input, init) => {
    const address = addressOf(input);
    const refusal = reaches(address);
    return refusal === undefined
      ? fetch(address, Object.assign(requestFieldsOf(input), Predicate.isObject(init) ? init : {}, unfollowed))
      : Promise.reject(new HostRefused({ rule: refusal }));
  };
}
