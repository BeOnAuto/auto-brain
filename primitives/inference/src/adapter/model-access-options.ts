import type { CredentialSources } from './credential-sources.ts';
import type { EntraIdentityLoader } from './entra-id.ts';
import type { Fetch } from './sdk-model.ts';

export interface ModelAccessOptions {
  readonly fetch?: Fetch;
  readonly credentials?: CredentialSources;
  readonly loadEntraIdentity?: EntraIdentityLoader;
}
