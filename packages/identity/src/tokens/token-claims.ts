import type { TokenClaims } from './access-token.ts';

const leewaySeconds = 60;

export function isTimely({ exp, nbf, iat }: TokenClaims, nowMs: number): boolean {
  const now = nowMs / 1000;
  return (
    now < exp + leewaySeconds &&
    (nbf === undefined || nbf <= now + leewaySeconds) &&
    (iat === undefined || iat <= now + leewaySeconds)
  );
}

export function isIntendedFor({ aud }: TokenClaims, publicUrl: string, path: string): boolean {
  const accepted = new Set([publicUrl, `${publicUrl}/`, `${publicUrl}${path}`]);
  return (typeof aud === 'string' ? [aud] : aud).some((audience) => accepted.has(audience));
}
