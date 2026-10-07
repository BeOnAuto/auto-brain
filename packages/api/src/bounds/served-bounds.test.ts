import { defineQuery, makeCatalog, makeDispatcher, type Registration } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { instructionsFor, mcpRoutes, type DefinitionType, type Guide, type Recipe } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { asking, sentencesOf } from '../testing/asking-operation.ts';
import { notebookGuide, noteRecipe, wordsGuide } from '../testing/guides.ts';
import { testServerInfo } from '../testing/operation-server.ts';

const reportedErrors: string[] = [];

const notebookTypes: readonly DefinitionType[] = [{ primitive: 'notes', noun: 'note', guide: 'notebook' }];

interface Serving {
  readonly operations?: readonly { readonly registration: Registration }[];
  readonly guides?: readonly Guide[];
  readonly recipes?: readonly Recipe[];
  readonly definitionTypes?: readonly DefinitionType[];
}

function starting({ operations = [], guides = [], recipes = [], definitionTypes = [] }: Serving): () => void {
  return () => {
    createTestHandler({
      routes: [
        mcpRoutes({
          catalog: makeCatalog(operations),
          dispatcher: makeDispatcher([]),
          runCall: () => Promise.reject(new Error('not called')),
          serverInfo: testServerInfo,
          definitionTypes,
          guides,
          recipes,
          reportError: (error) => {
            reportedErrors.push(error.message);
          },
        }),
      ],
    });
  };
}

function guideOf(name: string, text = '# A guide\n'): Guide {
  return { name, title: name, description: `The guide ${name}.`, text };
}

function typeOf(noun: string, guide = 'asking'): DefinitionType {
  return { primitive: 'asking', noun, guide };
}

const twoSentences = 'Asks. It answers. ';

function describedIn(length: number): string {
  return `${twoSentences}${sentencesOf(length - twoSentences.length)}`;
}

function sentencesNumbering(count: number): string {
  return Array.from({ length: count }, () => 'It asks.').join(' ');
}

describe('a tool description', () => {
  it('starts the server at 800 characters, and refuses to start it at 801', () => {
    expect(describedIn(800)).toHaveLength(800);
    expect(starting({ operations: [asking({ description: describedIn(800) })] })).not.toThrow();
    expect(starting({ operations: [asking({ description: describedIn(801) })] })).toThrow(
      'The description of ask_spec: 801 characters, more than the 800 allowed',
    );
  });

  it('starts the server at three sentences, and refuses to start it at two', () => {
    expect(starting({ operations: [asking({ description: sentencesNumbering(3) })] })).not.toThrow();
    expect(starting({ operations: [asking({ description: sentencesNumbering(2) })] })).toThrow(
      'The description of ask_spec: 2 sentences, fewer than the 3 required',
    );
  });

  it('starts the server at eight sentences, and refuses to start it at nine', () => {
    expect(starting({ operations: [asking({ description: sentencesNumbering(8) })] })).not.toThrow();
    expect(starting({ operations: [asking({ description: sentencesNumbering(9) })] })).toThrow(
      'The description of ask_spec: 9 sentences, more than the 8 allowed',
    );
  });
});

describe('the description of an argument', () => {
  it('starts the server at 300 characters, and refuses to start it at 301', () => {
    expect(starting({ operations: [asking({ argument: 'q'.repeat(300) })] })).not.toThrow();
    expect(starting({ operations: [asking({ argument: 'q'.repeat(301) })] })).toThrow(
      'The description of question of ask_spec: 301 characters, more than the 300 allowed',
    );
  });
});

function askingTools(count: number) {
  return Array.from({ length: count }, (_, index) => asking({ name: `ask_${String.fromCodePoint(97 + index)}` }));
}

describe('the description of an argument of one shape of a union input', () => {
  it('refuses to start the server over 300 characters', () => {
    const shaped = defineQuery('brain', {
      name: 'shape_spec',
      title: 'Shape',
      description: 'Shapes. Use it to shape. It answers.',
      route: { method: 'GET', path: '/shape' },
      inputSchema: Schema.Union([
        Schema.Struct({ circle: Schema.String.annotate({ description: 'c'.repeat(300) }) }),
        Schema.Struct({ square: Schema.String.annotate({ description: 's'.repeat(301) }) }),
      ]),
      outputSchema: Schema.Struct({ shaped: Schema.Boolean }),
      reasons: [],
      handle: () => Effect.succeed({ shaped: true }),
      plainLanguage: { task: 'shape', attempt: () => 'shape', outcome: () => 'Shaped.' },
    });

    expect(starting({ operations: [shaped] })).toThrow(
      'The description of square of shape_spec: 301 characters, more than the 300 allowed',
    );
  });
});

describe('the tools on a connection', () => {
  it('start the server at 24 with the guide tool, and refuse to start it at 25', () => {
    expect(starting({ operations: askingTools(23) })).not.toThrow();
    expect(starting({ operations: askingTools(24) })).toThrow(
      'The own org endpoint: 25 tools, more than the 24 allowed',
    );
  });
});

function instructionLengthWith(noun: string): number {
  return instructionsFor('own org', { orgTools: [], brainTools: ['ask_spec'] }, [typeOf(noun)], []).length;
}

function servingTypeOf(noun: string): Serving {
  return { operations: [asking({})], guides: [guideOf('asking')], definitionTypes: [typeOf(noun)] };
}

describe('the instructions of a connection', () => {
  it('start the server at 2,000 characters, and refuse to start it at 2,001', () => {
    const atTheBound = `b${'x'.repeat(2000 - instructionLengthWith('b'))}`;

    expect(instructionLengthWith(atTheBound)).toBe(2000);
    expect(starting(servingTypeOf(atTheBound))).not.toThrow();
    expect(starting(servingTypeOf(`${atTheBound}x`))).toThrow(
      'The instructions of the own org endpoint: 2001 characters, more than the 2000 allowed',
    );
  });
});

function guidesNumbering(count: number): readonly Guide[] {
  return Array.from({ length: count }, (_, index) => guideOf(`guide-${index}`));
}

function typesNumbering(count: number): readonly DefinitionType[] {
  return Array.from({ length: count }, (_, index) => typeOf('kind', `guide-${index}`));
}

function recipesNumbering(count: number): readonly Recipe[] {
  return Array.from({ length: count }, (_, index) => ({ ...noteRecipe, name: `recipe-${index}` }));
}

function noteRecipeSaying(text: string): Recipe {
  return { ...noteRecipe, text };
}

describe('the guides a server carries', () => {
  it('start the server with one guide a type it runs and the terminology, and refuse to start it with one more', () => {
    expect(starting({ guides: guidesNumbering(5), definitionTypes: typesNumbering(4) })).not.toThrow();
    expect(starting({ guides: guidesNumbering(6), definitionTypes: typesNumbering(4) })).toThrow(
      'The guides of the server: 6 guides, more than the 5 allowed',
    );
  });

  it('start the server with a guide of 65,536 bytes, and refuse to start it with one of 65,537', () => {
    expect(starting({ guides: [guideOf('large', 'é'.repeat(32_768))] })).not.toThrow();
    expect(starting({ guides: [guideOf('large', `${'é'.repeat(32_768)}.`)] })).toThrow(
      'The guide large: 65537 bytes, more than the 65536 allowed',
    );
  });

  it('start the server with four recipes, and refuse to start it with five', () => {
    expect(
      starting({ guides: [notebookGuide], recipes: recipesNumbering(4), definitionTypes: notebookTypes }),
    ).not.toThrow();
    expect(starting({ guides: [notebookGuide], recipes: recipesNumbering(5), definitionTypes: notebookTypes })).toThrow(
      'The recipes of the server: 5 recipes, more than the 4 allowed',
    );
  });

  it('start the server with a recipe of 4,096 bytes, and refuse to start it with one of 4,097', () => {
    expect(
      starting({
        guides: [notebookGuide],
        recipes: [noteRecipeSaying('r'.repeat(4096))],
        definitionTypes: notebookTypes,
      }),
    ).not.toThrow();
    expect(
      starting({
        guides: [notebookGuide],
        recipes: [noteRecipeSaying('r'.repeat(4097))],
        definitionTypes: notebookTypes,
      }),
    ).toThrow('The recipe take-a-note: 4097 bytes, more than the 4096 allowed');
  });
});

describe('a server without the guides it names', () => {
  it('refuses to start without the guide of a definition type it runs', () => {
    expect(
      starting({
        guides: [wordsGuide],
        definitionTypes: [{ primitive: 'inference', noun: 'reasoning function', guide: 'reasoning-function' }],
      }),
    ).toThrow('The definition type inference names the guide reasoning-function, which the server does not carry');
  });

  it('refuses to start without the format guide a recipe embeds', () => {
    expect(starting({ guides: [wordsGuide], recipes: [noteRecipe] })).toThrow(
      'The recipe take-a-note names the guide notebook, which the server does not carry',
    );
  });

  it('refuses to start with two guides of one name', () => {
    expect(starting({ guides: [notebookGuide, notebookGuide] })).toThrow(
      'The guide name notebook is used more than once',
    );
  });
});
