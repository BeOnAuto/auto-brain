import type { Effect } from 'effect';

import type { CredentialSources } from './credential-sources.ts';
import type { EntraIdentityLoader } from './entra-id.ts';
import type { Fetch } from './sdk-model.ts';

export interface ProviderMessageReport {
  readonly provider: string;
  readonly model: string;
  readonly status: number | null;
  readonly message: string;
  readonly execution_id: string | null;
}

export type ReportProviderMessage = (report: ProviderMessageReport) => Effect.Effect<void>;

export interface ModelAccessOptions {
  readonly fetch?: Fetch;
  readonly credentials?: CredentialSources;
  readonly loadEntraIdentity?: EntraIdentityLoader;
  readonly reportProviderMessage?: ReportProviderMessage;
}
