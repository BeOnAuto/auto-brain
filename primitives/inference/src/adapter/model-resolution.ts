import { Option, Result } from 'effect';

import { ModelNotOffered } from '../failure/model-not-offered.ts';
import { ProviderNotConfigured } from '../failure/provider-not-configured.ts';
import { SpecInvalid } from '../failure/spec-invalid.ts';
import { aliasResolution } from '../model/model-alias.ts';
import { modelOffer } from '../model/model-offer.ts';
import { parseModelReference } from '../model/model-reference.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import type { ModelFactory, SdkModel } from './sdk-model.ts';

export interface ModelTarget {
  readonly provider: string;
  readonly requested: string;
  readonly resolved: string;
  readonly model: () => SdkModel;
}

export type ModelResolution = (
  reference: string,
) => Result.Result<ModelTarget, SpecInvalid | ProviderNotConfigured | ModelNotOffered>;

function malformedReference(): SpecInvalid {
  return new SpecInvalid({
    detail: 'A model is written provider/model, for example anthropic/claude-sonnet-4-5',
    provider: null,
    status: null,
    provider_message: null,
    issues: [{ pointer: '/model', detail: 'Expected provider/model' }],
  });
}

function configuredOf({ configured }: ProviderStatus): string {
  return configured.length === 0 ? 'No model provider is configured' : `Configured providers: ${configured.join(', ')}`;
}

function aliasesOf(aliasNames: readonly string[]): string {
  return aliasNames.length === 0 ? '' : `. Aliases: ${aliasNames.join(', ')}`;
}

function notConfigured(provider: string, status: ProviderStatus, aliasNames: readonly string[]): ProviderNotConfigured {
  const missing = status.unconfigured.find((unconfigured) => unconfigured.provider === provider)?.missing;
  const absent = missing === undefined ? `There is no provider named ${provider}` : `${provider} is not configured`;
  return new ProviderNotConfigured({
    detail: `${absent}. ${configuredOf(status)}${aliasesOf(aliasNames)}`,
    provider,
    configured: status.configured,
    missing: missing ?? [],
  });
}

function notOffered(requested: string, provider: string, offered: readonly string[]): ModelNotOffered {
  return new ModelNotOffered({
    detail: `${requested} is not one of the models this server offers. Offered models: ${offered.join(', ')}`,
    provider,
    offered,
  });
}

export function modelResolution(
  models: ReadonlyMap<string, ModelFactory>,
  aliases: ReadonlyMap<string, string>,
  status: ProviderStatus,
  allowed: readonly string[] | null,
): ModelResolution {
  const resolve = aliasResolution(aliases);
  const offer = modelOffer(allowed);
  const aliasNames = [...aliases.keys()];
  return (requested) => {
    const resolved = resolve(requested);
    return Option.match(parseModelReference(resolved), {
      onNone: () => Result.fail(malformedReference()),
      onSome: ({ provider, model }) => {
        if (offer.restricted !== null && !offer.offers(requested)) {
          return Result.fail(notOffered(requested, provider, offer.restricted));
        }
        const factory = models.get(provider);
        return factory === undefined
          ? Result.fail(notConfigured(provider, status, aliasNames))
          : Result.succeed({ provider, requested, resolved, model: () => factory(model) });
      },
    });
  };
}
