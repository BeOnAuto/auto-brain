import { describe, expect, it } from 'vitest';

import { cachedStripping, notErasable, strippedExpression, strippedModule } from './type-stripping.ts';

describe('stripping the types of a program', () => {
  it('blanks its types where they stood, so every line and column stays where it was written', () => {
    const source =
      'type Reply = { text: string };\nexport function answer(input: Reply): string {\n  return input.text as string;\n}';

    const javascript =
      '                              \nexport function answer(input       )         {\n  return input.text          ;\n}';

    expect(strippedModule(source)).toEqual({ javascript });
    expect(javascript.split('\n').map((line) => line.length)).toEqual(source.split('\n').map((line) => line.length));
  });

  it('refuses syntax that is not erasable, naming the line it is on', () => {
    expect(
      strippedModule('const kept = 1;\nenum Color { Red }\nexport function fold(): number {\n  return kept;\n}'),
    ).toEqual({
      issue: { detail: notErasable, line: 2 },
    });
    expect(strippedModule('export class Point {\n  constructor(private x: number) {}\n}')).toEqual({
      issue: { detail: notErasable, line: 2 },
    });
    expect(strippedModule('// colours\n/* kept\n   apart */\n  enum Color { Red }')).toEqual({
      issue: { detail: notErasable, line: 4 },
    });
  });

  it('wraps an expression in a function of the names it uses, counting lines from the expression', () => {
    expect(strippedExpression('$data.total as number', ['$data'])).toEqual({
      javascript: '(($data) => (\n$data.total          \n))',
    });
    expect(strippedExpression('[\n  <number>$data.total,\n]', ['$data'])).toEqual({
      issue: { detail: notErasable, line: 2 },
    });
  });
});

describe('the cache of stripped programs', () => {
  it('answers what it stripped before without stripping again, keeping expressions of other names apart', () => {
    const stripping = cachedStripping();

    const first = stripping.module('export const x: number = 1;');
    const expression = stripping.expression('$data', ['$data']);

    expect(stripping.module('export const x: number = 1;')).toBe(first);
    expect(stripping.expression('$data', ['$data'])).toBe(expression);
    expect(stripping.expression('$data', ['$data', '$input'])).toEqual({
      javascript: '(($data, $input) => (\n$data\n))',
    });
  });
});
