import { JsonPointer, Predicate } from 'effect';

export interface SchemaIssue {
  readonly pointer: string;
  readonly detail: string;
}

interface Pending {
  readonly children: readonly unknown[];
  readonly level: number;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function childrenOf(value: unknown): readonly unknown[] | undefined {
  if (isList(value)) {
    return value;
  }
  return Predicate.isObject(value) ? Object.values(value) : undefined;
}

export function nestedDeeperThan(value: unknown, levels: number): boolean {
  const root = childrenOf(value);
  const pending: Pending[] = root === undefined ? [] : [{ children: root, level: 1 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.level > levels) {
      return true;
    }
    for (const child of next.children) {
      const children = childrenOf(child);
      if (children !== undefined) {
        pending.push({ children, level: next.level + 1 });
      }
    }
  }
  return false;
}

export function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((key) => `/${JsonPointer.escapeToken(String(key))}`).join('');
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
