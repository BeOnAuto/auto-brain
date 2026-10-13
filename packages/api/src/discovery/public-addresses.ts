import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';

export const healthPath = '/health';

export const apiCatalogPath = '/.well-known/api-catalog';

export function publicOriginOf(c: Context<ApiEnv>): string {
  return new URL(c.req.url).origin;
}

export function apiCatalogLinkTo(address: string): string {
  return `<${address}>; rel="api-catalog"`;
}
