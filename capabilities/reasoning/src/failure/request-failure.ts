import type { CredentialsRejected } from './credentials-rejected.ts';
import type { DefinitionInvalid } from './definition-invalid.ts';
import type { ModelNotAllowed } from './model-not-allowed.ts';
import type { ProviderNotConfigured } from './provider-not-configured.ts';

export type RequestFailure = DefinitionInvalid | ProviderNotConfigured | ModelNotAllowed | CredentialsRejected;
