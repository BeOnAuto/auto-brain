import { readFileSync } from 'node:fs';

import { mostReadCharacters } from '@on.auto/definitions/template';
import { describe, expect, it } from 'vitest';

import { reasoningWith } from '../testing/reasoning-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/reasoning-format.md', import.meta.url), 'utf8');

const [, example = ''] = /```markdown\n([\s\S]*?)```/u.exec(page) ?? [];

const [, toolsOfTheReference = ''] = /```yaml\n(tools: .+)\n```/u.exec(page) ?? [];

const exampleWithTools = example.replace(/^model: .+$/mu, (modelLine) => `${modelLine}\n${toolsOfTheReference}`);

const { prepared } = reasoningWith();

const counted = new Intl.NumberFormat('en');

function overviewOf(...lines: readonly string[]): string {
  return prepared(lines.join('\n')).overview('review-brief');
}

function sectionOf(overview: string, heading: string): string {
  return overview.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0] ?? '';
}

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function modelAndToolsOf(...tools: readonly string[]): string {
  const overview = overviewOf('---', 'model: openai/gpt-5', `tools: [${tools.join(', ')}]`, '---', 'Find it.');
  return sectionOf(overview, 'Which model and tools');
}

describe('the overviews of the example of the reference of reasoning functions', () => {
  it('are, byte for byte, the overviews pinned beside this test, without tools and with the tools of the reference', () => {
    expect(prepared(example).overview('review-brief')).toBe(goldenOf('reference-example.overview.md'));
    expect(prepared(exampleWithTools).overview('review-brief')).toBe(goldenOf('reference-tools.overview.md'));
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
  it('say the model and that it calls no tools, with nothing drawn, when its document names none', () => {
    const overview = overviewOf('---', 'model: openai/gpt-5', '---', 'Find it.');

    expect(sectionOf(overview, 'Which model and tools')).toBe(
      ['It reasons with the model `openai/gpt-5`.', 'It calls no tools.'].join('\n\n'),
    );
  });

  it('name each tool with its server, and every tool of a server named with a star', () => {
    const [model, mayCall, tools] = modelAndToolsOf('graph/search', 'notes/*').split('\n\n');

    expect([model, mayCall, tools]).toEqual([
      'It reasons with the model `openai/gpt-5`.',
      'It may call these tools:',
      '- the tool **search** of **graph**\n- every tool of **notes**',
    ]);
  });

  it('draw the function, the model it reasons with and each tool the model may call, then say how it calls them', () => {
    const [, , , diagram, howItCalls] = modelAndToolsOf('graph/search', 'notes/*').split('\n\n');

    expect(diagram).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1["review-brief"]',
        '  n2["openai/gpt-5"]',
        '  n3["graph/search"]',
        '  n4["every tool of notes"]',
        '  n1 -->|"reasons with"| n2',
        '  n2 -->|"may call"| n3',
        '  n2 -->|"may call"| n4',
        '```',
      ].join('\n'),
    );
    expect(howItCalls).toBe(
      "The model may call these tools before it answers, several in one step and over several steps, within a run's limits on calls, time and failures.",
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
