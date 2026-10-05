import {
  auth,
  ClientCredentialsProvider,
  PrivateKeyJwtProvider,
  type AuthProvider,
  type FetchLike,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';
import { Option, Redacted } from 'effect';

import type { AuthSettings } from '../settings/mcp-settings.ts';

export interface TokenSource extends AuthProvider {
  readonly token: () => Promise<string>;
  readonly onUnauthorized: () => Promise<void>;
}

export interface TokenSourceOptions {
  readonly serverUrl: string;
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly minted: (token: string) => void;
}

interface Held {
  readonly value: string;
  readonly renewAt: number;
}

const defaultLifetimeSeconds = 3600;

const mostRenewalLeadMs = 60_000;

function providerOf({ issuer, client_id, scope, credential }: AuthSettings): OAuthClientProvider {
  const common = { clientId: client_id, expectedIssuer: issuer, ...(scope === null ? {} : { scope }) };
  return credential.kind === 'client_secret'
    ? new ClientCredentialsProvider({ ...common, clientSecret: Redacted.value(credential.client_secret) })
    : new PrivateKeyJwtProvider({
        ...common,
        privateKey: Redacted.value(credential.private_key),
        algorithm: credential.algorithm,
      });
}

function renewalTime(issuedAt: number, lifetimeSeconds: number): number {
  const lifetimeMs = lifetimeSeconds * 1000;
  return issuedAt + lifetimeMs - Math.min(mostRenewalLeadMs, lifetimeMs / 2);
}

export function tokenSource(
  settings: AuthSettings,
  { serverUrl, fetch, now, minted }: TokenSourceOptions,
): TokenSource {
  let held: Held | undefined;
  let minting: Promise<string> | undefined;
  const mint = async (): Promise<string> => {
    const provider = providerOf(settings);
    await auth(provider, { serverUrl, fetchFn: fetch });
    const tokens = Option.getOrThrow(Option.fromNullishOr(await provider.tokens()));
    minted(tokens.access_token);
    held = { value: tokens.access_token, renewAt: renewalTime(now(), tokens.expires_in ?? defaultLifetimeSeconds) };
    return tokens.access_token;
  };
  const mintOnce = (): Promise<string> => {
    minting ??= mint().finally(() => {
      minting = undefined;
    });
    return minting;
  };
  return {
    token: () => (held !== undefined && now() < held.renewAt ? Promise.resolve(held.value) : mintOnce()),
    onUnauthorized: async () => {
      held = undefined;
      await mintOnce();
    },
  };
}
