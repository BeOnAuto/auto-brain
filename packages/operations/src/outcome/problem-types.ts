import type { RejectionKind } from './rejection.ts';

const problemTypes = 'https://on.auto/problems/';

export const kindsWithTypes = ['tools_unfinished'] as const satisfies readonly RejectionKind[];

export type KindWithType = (typeof kindsWithTypes)[number];

const typedKinds: ReadonlySet<string> = new Set(kindsWithTypes);

export function problemTypeOf(name: string): string {
  return `${problemTypes}${name}`;
}

export function isKindWithType(kind?: string): kind is KindWithType {
  return kind !== undefined && typedKinds.has(kind);
}
