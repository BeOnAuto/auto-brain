import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

export interface ProxySettings {
  readonly enabled: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

interface ProxiedAgent {
  readonly proxyEnv: Record<string, string | undefined>;
}

export interface AwsClientSettings {
  readonly requestHandler?: { readonly httpAgent: ProxiedAgent; readonly httpsAgent: ProxiedAgent };
}

export type AwsCredentialChain = ReturnType<typeof fromNodeProviderChain>;

export function awsClientSettingsOf(proxy: ProxySettings): AwsClientSettings {
  if (!proxy.enabled) {
    return {};
  }
  const agent = { proxyEnv: { ...proxy.environment } };
  return { requestHandler: { httpAgent: agent, httpsAgent: agent } };
}

export function awsCredentialChain(proxy: ProxySettings): AwsCredentialChain {
  return fromNodeProviderChain({ clientConfig: awsClientSettingsOf(proxy) });
}
