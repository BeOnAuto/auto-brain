import tsBlankSpace from 'ts-blank-space';

import { boundedCacheOf } from '../dsl/bounded-cache.ts';
import type { ProgramIssue } from './program-run.ts';

export type Stripped = { readonly javascript: string } | { readonly issue: ProgramIssue };

export interface Stripping {
  readonly module: (source: string) => Stripped;
  readonly expression: (source: string, names: readonly string[]) => Stripped;
}

export const notErasable = "This syntax is not allowed when 'erasableSyntaxOnly' is enabled";

export const mostStrippedCharacters = 262_144;

const expressionOpening = (names: readonly string[]): string => `((${names.join(', ')}) => (\n`;

const expressionClosing = '\n))';

const leadingTrivia = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/u;

function lineAt(source: string, node: unknown): number {
  const position = Number(Reflect.get(new Object(node), 'pos'));
  const rest = source.slice(position);
  const start = position + rest.length - rest.replace(leadingTrivia, '').length;
  return source.slice(0, start).split('\n').length;
}

function strippedText(source: string, firstLine: number): Stripped {
  const refused: unknown[] = [];
  const javascript = tsBlankSpace(source, (node: unknown) => {
    refused.push(node);
  });
  return refused.length === 0
    ? { javascript }
    : { issue: { detail: notErasable, line: Math.max(1, lineAt(source, refused[0]) - firstLine) } };
}

export function strippedModule(source: string): Stripped {
  return strippedText(source, 0);
}

export function strippedExpression(source: string, names: readonly string[]): Stripped {
  return strippedText(`${expressionOpening(names)}${source}${expressionClosing}`, 1);
}

export function cachedStripping(mostCharacters: number = mostStrippedCharacters): Stripping {
  const modules = boundedCacheOf<Stripped>(mostCharacters);
  const expressions = boundedCacheOf<Stripped>(mostCharacters);
  const remembered = (cache: typeof modules, key: string, strip: () => Stripped): Stripped => {
    const known = cache.get(key);
    if (known !== undefined) {
      return known;
    }
    const made = strip();
    cache.set(key, made);
    return made;
  };
  return {
    module: (source) => remembered(modules, source, () => strippedModule(source)),
    expression: (source, names) =>
      remembered(expressions, `${names.join(',')}\n${source}`, () => strippedExpression(source, names)),
  };
}
