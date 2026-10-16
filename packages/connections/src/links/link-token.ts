import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';
import { DateTime, Duration, Effect } from 'effect';

import type { OpenLink } from '../registry/registry.ts';

const tokenBytes = 32;

const linkLasts = Duration.minutes(10);

export interface IssuedLink extends OpenLink {
  readonly token: string;
}

export function tokenSha256Of(token: string): string {
  return sha256Of(token);
}

export const issuedLink: Effect.Effect<IssuedLink> = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const token = randomBytes(tokenBytes).toString('base64url');
  return {
    token,
    token_sha256: tokenSha256Of(token),
    expires_at: DateTime.formatIso(DateTime.addDuration(now, linkLasts)),
  };
});
