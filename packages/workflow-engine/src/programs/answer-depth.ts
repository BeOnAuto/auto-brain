import { mostValueDepth } from '../dsl/json.ts';

const quote = '"';

const backslash = '\\';

const opening: ReadonlySet<string> = new Set(['[', '{']);

const closing: ReadonlySet<string> = new Set([']', '}']);

const leastTextDeeper = 2 * mostValueDepth + 2;

const identifier = /^[A-Za-z_$][\w$]*$/u;

function nestingStep(character: string): number {
  if (opening.has(character)) {
    return 1;
  }
  return closing.has(character) ? -1 : 0;
}

function deepestNestingOf(text: string): number {
  const scan = { depth: 0, deepest: 0, inText: false, escaped: false };
  for (const character of text) {
    if (scan.inText) {
      scan.inText = scan.escaped || character !== quote;
      scan.escaped = !scan.escaped && character === backslash;
    } else {
      scan.inText = character === quote;
      scan.depth += nestingStep(character);
      scan.deepest = Math.max(scan.deepest, scan.depth);
    }
  }
  return scan.deepest;
}

function placeOf(path: string, key: string, list: boolean): string {
  if (list) {
    return `${path}[${key}]`;
  }
  return identifier.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function pathDeeperThan(value: unknown, path: string, room: number): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (room === 0) {
    return path;
  }
  const list = Array.isArray(value);
  for (const [key, child] of Object.entries(value)) {
    const found = pathDeeperThan(child, placeOf(path, key, list), room - 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function tooDeepIn(text: string): string | undefined {
  if (text.length < leastTextDeeper || deepestNestingOf(text) <= mostValueDepth) {
    return undefined;
  }
  return pathDeeperThan(JSON.parse(text), '$', mostValueDepth);
}
