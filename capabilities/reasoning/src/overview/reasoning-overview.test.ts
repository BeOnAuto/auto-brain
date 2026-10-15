import { readFileSync } from 'node:fs';

import { mostReadCharacters } from '@on.auto/definitions/template';
import { describe, expect, it } from 'vitest';

import { reasoningWith } from '../testing/reasoning-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/reasoning-format.md', import.meta.url), 'utf8');

const golden = readFileSync(new URL('reference-example.overview.md', import.meta.url), 'utf8');

const [, example = ''] = /```markdown\n([\s\S]*?)```/u.exec(page) ?? [];

const { prepared } = reasoningWith();

const counted = new Intl.NumberFormat('en');

function overviewOf(...lines: readonly string[]): string {
  return prepared(lines.join('\n')).overview('review-brief');
}

function sectionOf(overview: string, heading: string): string {
  return overview.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0] ?? '';
}

describe('the overview of the example of the reference of reasoning functions', () => {
  it('is, byte for byte, the overview pinned beside this test', () => {
    expect(prepared(example).overview('review-brief')).toBe(golden);
  });
});

describe('the reference of reasoning functions', () => {
  it('gives the bound of the instructions and the message an overview shows', () => {
    expect(page).toContain(`each cut past ${counted.format(mostReadCharacters)} characters`);
  });
});

describe('the overview of a reasoning function', () => {
  it('says the fields of a JSON answer, and the defaults its input takes in place of what a run leaves out', () => {
    const overview = overviewOf(
      '---',
      'model: openai/gpt-5',
      'input:',
      '  schema: {type: object, properties: {brief: {type: string}, tone: {type: string}, max: true}}',
      '  default: {tone: warm, max: 3, other: 1}',
      'output:',
      '  format: json',
      '  schema: {type: object, properties: {score: {type: integer, maximum: 10}}, required: [score]}',
      '---',
      'Score {{ input.brief }}',
    );

    expect(sectionOf(overview, 'What it needs')).toContain('| **tone** | no | Text, “warm” when left out. |');
    expect(sectionOf(overview, 'What it needs')).toContain('| **max** | no | Any value. |');
    expect(sectionOf(overview, 'What it produces')).toContain('| **score** | yes | A whole number, at most 10. |');
  });
});

describe('the model and tools of a reasoning function in its overview', () => {
  it('name each tool with its server, and every tool of a server named with a star', () => {
    const overview = overviewOf('---', 'model: openai/gpt-5', 'tools: [graph/search, notes/*]', '---', 'Find it.');

    expect(sectionOf(overview, 'Which model and tools')).toBe(
      [
        'It reasons with the model `openai/gpt-5`.',
        'It may call these tools:',
        '- the tool **search** of **graph**\n- every tool of **notes**',
      ].join('\n\n'),
    );
  });
});

describe('the overview of a reasoning function without an input schema or instructions', () => {
  it('says what it takes and what it is told', () => {
    const overview = overviewOf(
      '---',
      'model: openai/gpt-5',
      '---',
      '{% if input.vip %}Treat them as a VIP.{% endif %} Hello {{ input.name | default: "friend" }}.',
    );

    expect(sectionOf(overview, 'What it needs')).toBe('It takes any input, which its document does not describe.');
    expect(sectionOf(overview, 'What it is told')).toBe(
      [
        'Its message, with the values of each run in place of the names in bold:',
        'Treat them as a VIP when input.vip. Hello **name**.\n',
      ].join('\n\n'),
    );
  });
});
