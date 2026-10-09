import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

import type { ProxySettings } from '../settings/model-settings.ts';
import { OutboundFailure } from './outbound-failure.ts';

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export type AwsCredentialSource = () => Promise<AwsCredentials>;

export type AccessTokenSource = () => Promise<string>;

export interface GoogleTokenClient {
  readonly getAccessToken: () => Promise<string | null | undefined>;
}

export interface CredentialSources {
  readonly aws?: AwsCredentialSource;
  readonly google?: AccessTokenSource;
  readonly azure?: AccessTokenSource;
}

const googleCloudScope = 'https://www.googleapis.com/auth/cloud-platform';

export function guarded<Credential>(source: () => Promise<Credential>): () => Promise<Credential> {
  return async () => {
    try {
      return await source();
    } catch {
      throw new OutboundFailure('credential_lookup_failed');
    }
  };
}

export function awsCredentialChain(proxy: ProxySettings): AwsCredentialSource {
  const proxyAware = { clientConfig: { requestHandler: { httpsAgent: { proxyEnv: { ...proxy.environment } } } } };
  return fromNodeProviderChain(proxy.enabled ? proxyAware : {});
}

export function googleAccessTokens(client: GoogleTokenClient): AccessTokenSource {
  return async () => {
    const token = await client.getAccessToken();
    if (token === null || token === undefined || token === '') {
      throw new OutboundFailure('credential_lookup_failed');
    }
    return token;
  };
}

export function googleCredentialChain(project: string): AccessTokenSource {
  return googleAccessTokens(new GoogleAuth({ scopes: [googleCloudScope], projectId: project }));
}

export function refreshingGoogleClient(tokens: AccessTokenSource): OAuth2Client {
  const client = new OAuth2Client();
  client.refreshHandler = async () => ({ access_token: await tokens(), expiry_date: Date.now() });
  return client;
}
