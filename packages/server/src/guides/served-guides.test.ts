import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { mostGuideBytes, mostRecipeBytes } from '@beonauto/api';
import { definePrimitive, type Primitive, type PrimitiveGuide } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { withLinksResolved } from './page-links.ts';
import { servedGuidesOf } from './served-guides.ts';
import { withoutSiteMarkup } from './site-markup.ts';

function primitiveOf(name: string, noun: string, guide: PrimitiveGuide): Primitive {
  return definePrimitive({
    name,
    title: noun,
    guide,
    noun: { one: noun, other: `${noun}s` },
    describeOutput: () => 'It ran.',
    mediaType: 'text/markdown',
    parse: () => Effect.succeed({}),
    summarize: () => ({}),
    execute: () => Effect.succeed({ output: null, record: {} }),
  });
}

const onThisServer = 'On this server, a reasoning function names its model through anthropic.';

const reasoning = primitiveOf('inference', 'reasoning function', { name: 'reasoning-function', onThisServer });

const computation = primitiveOf('computation', 'computation function', { name: 'computation-function' });

const recall = primitiveOf('recollection', 'recall function', { name: 'recall-function' });

const workflow = primitiveOf('orchestration', 'workflow', { name: 'workflow' });

const everyType = [reasoning, computation, recall, workflow];

function page(path: string): string {
  return readFileSync(new URL(`../../../../docs/${path}`, import.meta.url), 'utf8');
}

function outsideCode(text: string): string {
  return text
    .split(/^```/mu)
    .filter((_, index) => index % 2 === 0)
    .join('');
}

const pages: Readonly<Record<string, string>> = {
  'reasoning-function': 'reference/reasoning-format.md',
  'computation-function': 'reference/computation-format.md',
  'recall-function': 'reference/recall-format.md',
  workflow: 'reference/workflow-format.md',
};

describe('the guides of a server that runs every type of definition', () => {
  const { definitionTypes, guides, recipes } = servedGuidesOf(everyType);

  it('are the terminology, a guide per type and the four recipes, nine in all', () => {
    expect([...guides, ...recipes].map(({ name }) => name)).toEqual([
      'terminology',
      'reasoning-function',
      'computation-function',
      'recall-function',
      'workflow',
      'first-brain',
      'remember',
      'give-tools',
      'schedule',
    ]);
    expect(definitionTypes).toEqual([
      { primitive: 'inference', noun: 'reasoning function', guide: 'reasoning-function' },
      { primitive: 'computation', noun: 'computation function', guide: 'computation-function' },
      { primitive: 'recollection', noun: 'recall function', guide: 'recall-function' },
      { primitive: 'orchestration', noun: 'workflow', guide: 'workflow' },
    ]);
  });

  it('give each type the whole public page of its format, without the markup of the documentation site, its links resolved, and the reasoning page what this server offers', () => {
    const [reasoningGuide, ...otherGuides] = guides.slice(1);
    const [reasoningPage = '', ...otherPages] = Object.values(pages);

    expect(reasoningGuide?.text).toBe(
      `${withLinksResolved(withoutSiteMarkup(page(reasoningPage)), reasoningPage).trimEnd()}\n\n${onThisServer}\n`,
    );
    expect(otherGuides.map(({ text }) => text)).toEqual(
      otherPages.map((path) => withLinksResolved(withoutSiteMarkup(page(path)), path)),
    );
  });

  it('title each type guide as its page is titled', () => {
    expect(guides.slice(1).map(({ title }) => title)).toEqual([
      'Reasoning function format',
      'Computation function format',
      'Recall function format',
      'Workflow format',
    ]);
  });

  it('keep no link a reader of the guide could not follow', () => {
    expect(guides.filter(({ text }) => /\]\((?!https:\/\/)[^)]*\)/u.test(outsideCode(text)))).toEqual([]);
  });
});

describe('the text of the guides of a server', () => {
  it('holds none of the markup the documentation site needs', () => {
    const { guides } = servedGuidesOf(everyType);

    expect(
      guides.filter(({ text }) => /^<div v-pre>|^<\/div>$|^<!-- prettier-ignore -->$/mu.test(outsideCode(text))),
    ).toEqual([]);
  });
});

describe('the size and the words of the guides of a server', () => {
  const { guides, recipes } = servedGuidesOf(everyType);

  it('stay under 64 KiB each, and each recipe under 4 KiB', () => {
    expect(guides.filter(({ text }) => Buffer.byteLength(text, 'utf8') > mostGuideBytes)).toEqual([]);
    expect(recipes.filter(({ text }) => Buffer.byteLength(text, 'utf8') > mostRecipeBytes)).toEqual([]);
  });

  it('describe each guide in a sentence for a person or a client that lists them', () => {
    expect(guides.slice(1).map(({ description }) => description)).toEqual([
      'How reasoning functions are written: their document, fields, examples and bounds.',
      'How computation functions are written: their document, fields, examples and bounds.',
      'How recall functions are written: their document, fields, examples and bounds.',
      'How workflows are written: their document, fields, examples and bounds.',
    ]);
  });
});

describe('the recipes of a server', () => {
  it('leave out a recipe whose format guide the server does not carry', () => {
    expect(servedGuidesOf([reasoning, workflow]).recipes.map(({ name }) => name)).toEqual([
      'first-brain',
      'give-tools',
      'schedule',
    ]);
    expect(servedGuidesOf([]).recipes).toEqual([]);
  });

  it('ask the person in their own words, filled into what the prompt asks for', () => {
    const asked = Object.fromEntries(servedGuidesOf(everyType).recipes.map(({ name, request }) => [name, request]));

    expect([
      asked['first-brain']?.({}),
      asked['remember']?.({ what: 'what it posted today' }),
      asked['give-tools']?.({}),
      asked['give-tools']?.({ server: 'slack' }),
      asked['schedule']?.({ workflow: 'daily-digest', when: 'every weekday at 9:00' }),
    ]).toEqual([
      'Create my first brain.',
      'Make the brain remember what it posted today.',
      'Give the brain tools.',
      'Give the brain the tools of the tool server slack.',
      'Run the workflow daily-digest every weekday at 9:00.',
    ]);
  });
});

describe('the recipes that give a brain tools', () => {
  it('test a tool to learn what it answers, and never make a function to look, within the bound of a recipe', () => {
    const texts = Object.fromEntries(servedGuidesOf(everyType).recipes.map(({ name, text }) => [name, text]));

    expect(String(texts['give-tools'])).toContain(
      "4. To learn what a tool answers, test it with test_tool_call, with the arguments its input_schema takes, and read the answer: that is what the function's model will see. Never make a function to look. When a prompt needs an id, such as a channel's, test the tool that lists them and take the id from its answer, confirming the choice with the person. A tool that cannot be tested may change something; list_tool_servers says which can.",
    );
    expect(String(texts['first-brain'])).toContain(
      "When it should use a tool server's tools, follow the give-tools recipe: to learn what a tool answers, test it with test_tool_call, and never make a function to look.",
    );
    expect([Buffer.byteLength(String(texts['give-tools'])), Buffer.byteLength(String(texts['first-brain']))]).toEqual([
      2058, 1761,
    ]);
  });
});

const calledWhereListed: ReadonlySet<string> = new Set(['get_guide', 'list_models']);

const fieldsNamed: ReadonlySet<string> = new Set(['input_schema']);

function toolsNamedIn(text: string): readonly string[] {
  return [...new Set(text.replaceAll(/`[^`]*`/gu, '').match(/\b[a-z]+(?:_[a-z]+)+\b/gu))].filter(
    (name) => !calledWhereListed.has(name) && !fieldsNamed.has(name),
  );
}

describe('the tools a recipe calls', () => {
  it('are every tool its steps name, but the guide tool, listed on every connection, list_models, called only where it is listed, and the fields of a tool they name', () => {
    const { recipes } = servedGuidesOf(everyType);

    expect(recipes.map(({ name, text }) => [name, toolsNamedIn(text).toSorted()])).toEqual(
      recipes.map(({ name, calls }) => [name, calls.toSorted()]),
    );
    expect(recipes[0]?.text).toContain('list_models where this connection has it');
  });
});

describe('the terminology guide of a server', () => {
  it('names only the types of definition the server runs', () => {
    const [terminology] = servedGuidesOf([reasoning, workflow]).guides;

    expect(terminology?.text).toContain('- Reasoning: Reasoning function.');
    expect(terminology?.text).toContain('- Coordination: Workflow.');
    expect(
      ['recall function', 'computation function', 'interaction function', 'prediction function'].filter((type) =>
        String(terminology?.text).toLowerCase().includes(type),
      ),
    ).toEqual([]);
  });
});

describe('a server without the page of a type it runs', () => {
  it('fails to start', () => {
    expect(() => servedGuidesOf([primitiveOf('drafting', 'draft', { name: 'drafting-function' })])).toThrow(
      /no such file or directory.*drafting-format\.md/u,
    );
  });
});
