import type { Cancelled } from './cancelled.ts';
import type { ContentRefused } from './content-refused.ts';
import type { CredentialsRejected } from './credentials-rejected.ts';
import type { OutputInvalid } from './output-invalid.ts';
import type { ProviderNotConfigured } from './provider-not-configured.ts';
import type { ProviderUnavailable } from './provider-unavailable.ts';
import type { RateLimited } from './rate-limited.ts';
import type { SpecInvalid } from './spec-invalid.ts';
import type { TimedOut } from './timed-out.ts';

export type ModelFailure =
  | SpecInvalid
  | ProviderNotConfigured
  | CredentialsRejected
  | RateLimited
  | ProviderUnavailable
  | ContentRefused
  | OutputInvalid
  | TimedOut
  | Cancelled;
