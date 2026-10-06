const problemTypes = 'https://on.auto/problems/';

const reasonsOfKinds = { tools_unfinished: 'unavailable', tools_called: 'conflict' } as const;

export type KindWithType = keyof typeof reasonsOfKinds;

export const kindsWithTypes: readonly KindWithType[] = ['tools_unfinished', 'tools_called'];

export function problemTypeOf(name: string): string {
  return `${problemTypes}${name}`;
}

export function isKindWithType(kind?: string): kind is KindWithType {
  return kind !== undefined && Object.hasOwn(reasonsOfKinds, kind);
}

export function reasonOfKind(kind: KindWithType): (typeof reasonsOfKinds)[KindWithType] {
  return reasonsOfKinds[kind];
}
