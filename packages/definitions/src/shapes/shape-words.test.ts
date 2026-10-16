import { describe, expect, it } from 'vitest';

import { outputSection, outputShapeNames, type OverviewBlock, type Phrases } from '../index.ts';
import { shapeNamed } from '../testing/index.ts';

function plain(phrases: Phrases): string {
  return phrases
    .map((phrase) => (typeof phrase === 'string' ? phrase : `**${Object.values(phrase).join('')}**`))
    .join('');
}

function shown(block: OverviewBlock): string {
  return block.kind === 'paragraph' ? plain(block.phrases) : block.kind;
}

describe('the words of an output of a shape', () => {
  it('say the shape in one paragraph of what it produces, in place of its fields', () => {
    expect(
      outputShapeNames().map((name) => {
        const { heading, blocks } = outputSection(shapeNamed(name).schema, shapeNamed(name));
        return [heading].concat(blocks.map((block) => shown(block)));
      }),
    ).toEqual([
      [
        'What it produces',
        'It answers a series over time, in **unit**: 1 to 20 lines, one for each **name**, of at most 2,000 **points** in all, each a **value** at its **at**, with a **low** and a **high** where given, and at most 8 **marks**, each a **value** with a **label**. Each **at** is a day, week, month, quarter or year, as **period** names, or a date and time where it names none, and **origin** is the last one observed.',
      ],
      [
        'What it produces',
        'It answers 1 to 200 **values**, in **unit**, each a **value** under a **name** of its own, with a **low** and a **high** where given.',
      ],
      [
        'What it produces',
        'It answers a table of 1 to 50 **columns**, each a **name** of its own with a **unit** where given, and at most 500 **rows**, each one cell for each column: text, a number, yes or no, or nothing.',
      ],
      ['What it produces', 'It answers a **text**: Markdown of at most 65,536 bytes.'],
    ]);
  });

  it('leave the fields of a schema without a shape to the words of the schema', () => {
    expect(outputSection({ type: 'string' }).blocks.map((block) => shown(block))).toEqual(['Text.']);
  });
});
