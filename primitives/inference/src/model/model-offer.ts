import { aliasPatternOf, type AliasPattern } from './model-alias.ts';

export interface ModelOffer {
  readonly restricted: readonly string[] | null;
  readonly offers: (reference: string) => boolean;
  readonly offersEvery: (pattern: string) => boolean;
}

function admits(entry: AliasPattern, reference: string): boolean {
  return entry.wildcard
    ? reference.length > entry.prefix.length && reference.startsWith(entry.prefix)
    : reference === entry.prefix;
}

function covers(entry: AliasPattern, pattern: AliasPattern): boolean {
  return entry.wildcard && pattern.prefix.startsWith(entry.prefix);
}

export function modelOffer(allowed: readonly string[] | null): ModelOffer {
  if (allowed === null) {
    return { restricted: null, offers: () => true, offersEvery: () => true };
  }
  const entries = allowed.map((reference) => aliasPatternOf(reference));
  return {
    restricted: allowed,
    offers: (reference) => entries.some((entry) => admits(entry, reference)),
    offersEvery: (pattern) => entries.some((entry) => covers(entry, aliasPatternOf(pattern))),
  };
}
