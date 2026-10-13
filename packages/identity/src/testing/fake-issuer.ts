import { constants, generateKeyPairSync, sign, type KeyObject, type SigningOptions } from 'node:crypto';

export type FakeSigner = 'RS256' | 'PS256' | 'ES256' | 'Ed25519' | 'Ed448';

export type Claims = Readonly<Record<string, unknown>>;

export interface Signing {
  readonly signer?: FakeSigner;
  readonly header?: Claims;
}

export interface FakeClient {
  readonly secret: string;
  readonly claims: Claims;
}

export interface FakeIssuerOptions {
  readonly metadata?: Claims;
  readonly clients?: Readonly<Record<string, FakeClient>>;
}

export interface FakeIssuer {
  readonly issuer: string;
  readonly answer: (request: Readonly<Request>) => Promise<Response>;
  readonly sign: (claims: Claims, signing?: Signing) => string;
  readonly rotate: () => void;
  readonly keySetReads: () => number;
}

interface FakeKey {
  readonly kid: string;
  readonly jwk: Claims;
  readonly sign: (data: string) => string;
}

const headerAlgorithms: Readonly<Record<FakeSigner, string>> = {
  RS256: 'RS256',
  PS256: 'PS256',
  ES256: 'ES256',
  Ed25519: 'EdDSA',
  Ed448: 'EdDSA',
};

const signingOptions: Readonly<Record<FakeSigner, SigningOptions>> = {
  RS256: { padding: constants.RSA_PKCS1_PADDING },
  PS256: { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
  ES256: { dsaEncoding: 'ieee-p1363' },
  Ed25519: {},
  Ed448: {},
};

interface KeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

const pairs: Readonly<Record<FakeSigner, () => KeyPair>> = {
  RS256: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
  PS256: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
  ES256: () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  Ed25519: () => generateKeyPairSync('ed25519'),
  Ed448: () => generateKeyPairSync('ed448'),
};

function keyOf(signer: FakeSigner, generation: number): FakeKey {
  const { publicKey, privateKey } = pairs[signer]();
  const kid = `${signer.toLowerCase()}-${generation}`;
  const digest = headerAlgorithms[signer] === 'EdDSA' ? null : 'sha256';
  return {
    kid,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: headerAlgorithms[signer], use: 'sig' },
    sign: (data) =>
      sign(digest, Buffer.from(data), { key: privateKey, ...signingOptions[signer] }).toString('base64url'),
  };
}

type FakeKeys = Readonly<Record<FakeSigner, FakeKey>>;

function keysOf(generation: number): FakeKeys {
  return {
    RS256: keyOf('RS256', generation),
    PS256: keyOf('PS256', generation),
    ES256: keyOf('ES256', generation),
    Ed25519: keyOf('Ed25519', generation),
    Ed448: keyOf('Ed448', generation),
  };
}

function segmentOf(value: Claims): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const lifetimeSeconds = 3600;

type Sign = (claims: Claims, signing?: Signing) => string;

function clientOf(request: Readonly<Request>, clients: Readonly<Record<string, FakeClient>>): string | undefined {
  const credentials = Buffer.from(String(request.headers.get('authorization')).replace(/^Basic /u, ''), 'base64');
  const [id = '', secret] = decodeURIComponent(credentials.toString('utf8')).split(':');
  return Object.hasOwn(clients, id) && clients[id]?.secret === secret ? id : undefined;
}

function tokenEndpoint(
  issuer: string,
  clients: Readonly<Record<string, FakeClient>>,
  signed: Sign,
): (request: Readonly<Request>) => Promise<Response> {
  return async (request) => {
    const form = new URLSearchParams(await request.text());
    const client = clientOf(request, clients);
    if (form.get('grant_type') !== 'client_credentials' || client === undefined) {
      return json({ error: 'invalid_client' }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const minted = signed({
      iss: issuer,
      sub: client,
      aud: form.get('resource') ?? issuer,
      iat: now,
      exp: now + lifetimeSeconds,
      scope: form.get('scope') ?? '',
      client_id: client,
      ...clients[client]?.claims,
    });
    return json({ access_token: minted, token_type: 'Bearer', expires_in: lifetimeSeconds });
  };
}

function metadataOf(issuer: string, metadata: Claims): Claims {
  const { origin } = new URL(issuer);
  return {
    issuer,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    jwks_uri: `${origin}/jwks`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    response_types_supported: ['code'],
    ...metadata,
  };
}

export function fakeIssuer(issuer: string, { metadata = {}, clients = {} }: FakeIssuerOptions = {}): FakeIssuer {
  const metadataPath = `/.well-known/oauth-authorization-server${new URL(issuer).pathname.replace(/\/$/u, '')}`;
  let generation = 1;
  let keys = keysOf(generation);
  let reads = 0;
  const signed: Sign = (claims, { signer = 'RS256', header = {} } = {}) => {
    const key = keys[signer];
    const head = segmentOf({ alg: headerAlgorithms[signer], kid: key.kid, typ: 'at+jwt', ...header });
    const body = segmentOf(claims);
    return `${head}.${body}.${key.sign(`${head}.${body}`)}`;
  };
  const token = tokenEndpoint(issuer, clients, signed);
  return {
    issuer,
    answer: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/token') {
        return token(request);
      }
      reads += Number(pathname === '/jwks');
      const documents = new Map([
        [metadataPath, metadataOf(issuer, metadata)],
        ['/jwks', { keys: Object.values(keys).map(({ jwk }) => jwk) }],
      ]);
      const document = documents.get(pathname);
      return Promise.resolve(document === undefined ? json({}, 404) : json(document));
    },
    sign: signed,
    rotate: () => {
      generation += 1;
      keys = keysOf(generation);
    },
    keySetReads: () => reads,
  };
}
