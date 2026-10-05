import { Order } from 'effect';

import type { ListedModel } from '../listing/listed-model.ts';
import { isWildcardAlias } from '../model/model-alias.ts';
import type { ModelOffer } from '../model/model-offer.ts';
import type { ModelEntry } from './model-list.ts';

const arn = /(?:^|\/)arn:/u;

export const byId = Order.mapInput(Order.String, ({ id }: ModelEntry) => id);

function providerOf(reference: string): string {
  return reference.slice(0, reference.indexOf('/'));
}

export function entryOf(provider: string, { id, ...details }: ListedModel): ModelEntry {
  return { id, object: 'model', owned_by: provider, ...details };
}

export function anyModelOf(provider: string): ModelEntry {
  return { id: `${provider}/*`, object: 'model', created: 0, owned_by: provider, pattern: true };
}

export function aliasEntryOf([alias, target]: readonly [string, string]): ModelEntry {
  return {
    id: alias,
    object: 'model',
    created: 0,
    owned_by: providerOf(target),
    ...(arn.test(target) ? {} : { resolved_to: target }),
    ...(isWildcardAlias(alias) ? { pattern: true } : {}),
  };
}

export function isOffered(offer: ModelOffer, { id, pattern }: ModelEntry): boolean {
  return pattern === true ? offer.offersEvery(id) : offer.offers(id);
}

export function uniqueById(entries: readonly ModelEntry[]): readonly ModelEntry[] {
  return [...new Map(entries.toReversed().map((entry) => [entry.id, entry])).values()];
}
