import { Buffer } from 'node:buffer';
import { verify } from 'node:crypto';

import { Schema } from 'effect';

export interface ClientRegistration {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly publicKey?: string;
  readonly expiresInSeconds: number | null;
  readonly issuer?: string;
}

export interface FakeAuthorization {
  readonly answer: (request: Readonly<Request>) => Promise<Response> | undefined;
  readonly accepts: (token: string) => boolean;
  readonly tokenRequests: () => number;
  readonly revokeEveryToken: () => void;
}

const decodeClaims = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ sub: Schema.String })));

const lifetimeWhenUnsaid = 3600;

const jsonHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function basicClientOf(request: Readonly<Request>): string {
  const credentials = String(request.headers.get('authorization')).replace(/^Basic /u, '');
  return decodeURIComponent(Buffer.from(credentials, 'base64').toString('utf8'));
}

function signedBy(assertion: string, publicKey: string): string | undefined {
  const parts = assertion.split('.');
  const signed = Buffer.from(parts.slice(0, 2).join('.'));
  const genuine = verify('sha256', signed, publicKey, Buffer.from(String(parts[2]), 'base64url'));
  return genuine ? decodeClaims(Buffer.from(String(parts[1]), 'base64url').toString('utf8')).sub : undefined;
}

function isClient(
  registration: ClientRegistration,
  request: Readonly<Request>,
  form: Readonly<URLSearchParams>,
): boolean {
  const { clientId, clientSecret, publicKey } = registration;
  const assertion = form.get('client_assertion');
  if (assertion !== null && publicKey !== undefined) {
    return signedBy(assertion, publicKey) === clientId;
  }
  return basicClientOf(request) === `${clientId}:${String(clientSecret)}`;
}

export function fakeAuthorization(origin: string, registration: ClientRegistration): FakeAuthorization {
  const live = new Map<string, number>();
  let requested = 0;
  const metadata = {
    issuer: registration.issuer ?? origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
  };
  const token = async (request: Readonly<Request>): Promise<Response> => {
    requested += 1;
    const form = new URLSearchParams(await request.text());
    if (form.get('grant_type') !== 'client_credentials' || !isClient(registration, request, form)) {
      return json({ error: 'invalid_client' }, 401);
    }
    const minted = `token-${requested}-${crypto.randomUUID()}`;
    const { expiresInSeconds } = registration;
    live.set(minted, Date.now() + (expiresInSeconds ?? lifetimeWhenUnsaid) * 1000);
    const expiry = expiresInSeconds === null ? {} : { expires_in: expiresInSeconds };
    return json({ access_token: minted, token_type: 'Bearer', ...expiry });
  };
  const documents: ReadonlyMap<string, () => Promise<Response>> = new Map([
    [
      '/.well-known/oauth-protected-resource/mcp',
      () => Promise.resolve(json({ resource: `${origin}/mcp`, authorization_servers: [origin] })),
    ],
    ['/.well-known/oauth-authorization-server', () => Promise.resolve(json(metadata))],
  ]);
  return {
    answer: (request) => {
      const { pathname } = new URL(request.url);
      return pathname === '/token' ? token(request) : documents.get(pathname)?.();
    },
    accepts: (presented) => (live.get(presented) ?? 0) > Date.now(),
    tokenRequests: () => requested,
    revokeEveryToken: () => {
      live.clear();
    },
  };
}
