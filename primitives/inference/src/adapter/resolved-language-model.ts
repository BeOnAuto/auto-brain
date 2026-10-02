import { Effect } from 'effect';

import { LanguageModel } from '../model/language-model.ts';
import { providersShowingMessages, secretScrubber } from '../settings/message-exposure.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import { gatewayOptionsCheck } from './gateway-options.ts';
import { generation } from './generation.ts';
import type { ModelAccessOptions } from './model-access-options.ts';
import { modelResolution } from './model-resolution.ts';
import type { ModelFactory } from './sdk-model.ts';

export function resolvedLanguageModel(
  models: ReadonlyMap<string, ModelFactory>,
  settings: ModelSettings,
  status: ProviderStatus,
  { reportProviderMessage, reportOperatorHint }: ModelAccessOptions,
): LanguageModel['Service'] {
  const showing = providersShowingMessages(settings);
  return LanguageModel.of({
    generate: generation(modelResolution(models, settings.aliases, status), {
      configured: status.configured,
      showsProviderMessages: (provider) => showing.has(provider),
      scrub: secretScrubber(settings),
      report: reportProviderMessage ?? (() => Effect.void),
      reportHint: reportOperatorHint ?? (() => Effect.void),
      admitsOptions: gatewayOptionsCheck(settings.gateways),
    }),
  });
}
