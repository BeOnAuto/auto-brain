import type { CredentialsRejected } from './credentials-rejected.ts';
import type { ModelNotAllowed } from './model-not-allowed.ts';
import type { ProviderNotConfigured } from './provider-not-configured.ts';
import type { SpecInvalid } from './spec-invalid.ts';

export type RequestFailure = SpecInvalid | ProviderNotConfigured | ModelNotAllowed | CredentialsRejected;
