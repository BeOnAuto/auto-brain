import { Effect } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import { providerStatus, type ProviderStatus } from '../settings/provider-status.ts';
import { azureTokensFor, loadEntraIdentity } from './entra-id.ts';
import type { ModelAccessOptions } from './model-access-options.ts';
import { modelFactories } from './model-factories.ts';
import { resolvedLanguageModel } from './resolved-language-model.ts';
import { installSdkGlobals } from './sdk-globals.ts';

export interface ModelAccess {
  readonly languageModel: LanguageModel['Service'];
  readonly status: ProviderStatus;
  readonly offered: OfferedModels;
}

export const makeModelAccess = Effect.fnUntraced(function* (settings: ModelSettings, options: ModelAccessOptions = {}) {
  installSdkGlobals();
  const credentials = options.credentials ?? {};
  const azureTokens = yield* azureTokensFor(
    settings.azure,
    credentials.azure,
    options.loadEntraIdentity ?? loadEntraIdentity,
  );
  const status = providerStatus(settings, { entraId: azureTokens !== undefined });
  const models = modelFactories(settings, { fetch: options.fetch ?? globalThis.fetch, credentials, azureTokens });
  const access: ModelAccess = {
    languageModel: resolvedLanguageModel(models, settings, status, options.reportProviderMessage),
    status,
    offered: { providers: status.configured, aliases: [...settings.aliases.keys()] },
  };
  return access;
});
