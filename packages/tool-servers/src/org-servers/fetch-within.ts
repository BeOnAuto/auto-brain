import type { FetchLike } from '@modelcontextprotocol/client';

export type Reaches = (url: string) => string | undefined;

class HostNotReached extends Error {}

const unfollowed = { redirect: 'manual' } as const;

export function fetchWithin(fetch: FetchLike, reaches: Reaches): FetchLike {
  return (...[url, init]: readonly [unknown, unknown?]) => {
    const address = String(url);
    const refusal = reaches(address);
    return refusal === undefined
      ? fetch(address, Object.assign({}, init, unfollowed))
      : Promise.reject(new HostNotReached(refusal));
  };
}
