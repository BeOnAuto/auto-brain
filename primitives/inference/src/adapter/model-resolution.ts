import { Option, Result } from 'effect';

import { ProviderNotConfigured } from '../failure/provider-not-configured.ts';
import { SpecInvalid } from '../failure/spec-invalid.ts';
import { parseModelReference } from '../model/model-reference.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import type { ModelFactory, SdkModel } from './sdk-model.ts';

export interface ModelTarget {
  readonly provider: string;
  readonly requested: string;
  readonly resolved: string;
  readonly model: () => SdkModel;
}

export type ModelResolution = (reference: string) => Result.Result<ModelTarget, SpecInvalid | ProviderNotConfigured>;

function malformedReference(): SpecInvalid {
  return new SpecInvalid({
    detail: 'A model is written provider/model, for example anthropic/claude-sonnet-4-5',
    provider: null,
    status: null,
    provider_message: null,
    issues: [{ pointer: '/model', detail: 'Expected provider/model' }],
  });
}

function notConfigured(provider: string, status: ProviderStatus): ProviderNotConfigured {
  const missing = status.unconfigured.find((unconfigured) => unconfigured.provider === provider)?.missing;
  const configured = status.configured.length === 0 ? 'none' : status.configured.join(', ');
  return new ProviderNotConfigured({
    detail:
      missing === undefined
        ? `There is no provider named ${provider}. Configured providers: ${configured}`
        : `${provider} is not configured; it needs ${missing.join(' and ')}`,
    provider,
    configured: status.configured,
    missing: missing ?? [],
  });
}

export function modelResolution(
  models: ReadonlyMap<string, ModelFactory>,
  aliases: ReadonlyMap<string, string>,
  status: ProviderStatus,
): ModelResolution {
  return (requested) => {
    const resolved = aliases.get(requested) ?? requested;
    return Option.match(parseModelReference(resolved), {
      onNone: () => Result.fail(malformedReference()),
      onSome: ({ provider, model }) => {
        const factory = models.get(provider);
        return factory === undefined
          ? Result.fail(notConfigured(provider, status))
          : Result.succeed({ provider, requested, resolved, model: () => factory(model) });
      },
    });
  };
}
