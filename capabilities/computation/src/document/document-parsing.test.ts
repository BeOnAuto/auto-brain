import { issueText } from '@beonauto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import { programDocument } from '../testing/computation-runs.ts';
import type { ComputationFunctionDefinitionDocument } from './computation-document.ts';
import { parseComputationDocument } from './document-parsing.ts';
import { computationDialect } from './program-dialect.ts';

const readsOutside =
  'reads something other than the input, so the same input would not give the same output; pass it in';

const hostTimeZone = "reads the server's time zone, so it is not the same everywhere; use the UTC date functions";

const writesOutside = 'writes outside the program; a computation function answers only with its output';

const wrongAnswers = 'gives wrong answers in this dialect of jq; use reduce, foreach, limit or first instead';

const labelled = '(label $out | 1, break $out)';

const refusals: readonly (readonly [string, string, string])[] = [
  ['now', 'reads the clock, so the same input would not give the same output; pass the time in the input', 'now'],
  ['env', readsOutside, 'env'],
  ['$ENV', readsOutside, '$ENV'],
  ['input', readsOutside, 'input'],
  ['inputs', readsOutside, 'inputs'],
  ['input_filename', readsOutside, 'input_filename'],
  ['input_line_number', readsOutside, 'input_line_number'],
  ['$__loc__', readsOutside, '$__loc__'],
  ['builtins', readsOutside, 'builtins'],
  ['localtime', hostTimeZone, 'localtime'],
  ['strflocaltime', hostTimeZone, 'strflocaltime("%H")'],
  ['debug', writesOutside, 'debug'],
  ['stderr', writesOutside, 'stderr'],
  ['halt', writesOutside, 'halt'],
  ['halt_error', writesOutside, 'halt_error'],
  ['label', wrongAnswers, labelled],
  ['break', wrongAnswers, labelled],
];

function parsed(source: string): ComputationFunctionDefinitionDocument {
  return Result.getOrThrow(parseComputationDocument(source));
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseComputationDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a computation function definition', () => {
  it('is front matter of the keys of a reason function that apply, language, and a program as its body', () => {
    const document = parsed(campaignPace);

    expect(document).toMatchObject({
      description: 'Spend, pace and projection per campaign, in cents, for a reporting period',
      language: 'jq',
      input: { schema: { document: { type: 'object', required: ['rows', 'period'] } } },
      output: { schema: { document: { type: 'object', required: ['campaigns', 'total_spend_cents'] } } },
      programLine: 19,
    });
    expect(document.program.startsWith('.period as $p\n| .rows')).toBe(true);
  });

  it('needs only a language and a program, and takes a schema of any value', () => {
    expect(parsed(programDocument('. + 1'))).toEqual({
      language: 'jq',
      input: {},
      output: {},
      program: '. + 1',
      programLine: 4,
    });
    expect(
      parsed(programDocument('.', 'language: jq\ninput: {schema: {type: integer}}')).input.schema?.document,
    ).toEqual({ type: 'integer' });
  });
});

describe('the front matter of a computation function definition', () => {
  it('names at least the language, and opens the document', () => {
    expect(issuesIn(programDocument('.', '# nothing'))).toEqual([
      'Line 2: The front matter is empty; it names at least the language',
    ]);
    expect(issuesIn('. + 1')).toEqual([
      'Line 1: A computation function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(issuesIn(programDocument('.', 'description: Adds one'))).toEqual([
      'Line 2, /language: language is required',
    ]);
  });

  it('refuses the keys of a reason function that do not apply, as keys it does not take', () => {
    expect(
      issuesIn(
        programDocument(
          '.',
          'language: jq\nmodel: anthropic/claude-sonnet-4-5\nconfig: {temperature: 0}\ntools: [graph/*]\ninput: {default: {}}\noutput: {format: json}',
        ),
      ),
    ).toEqual([
      'Line 3, /model: model is not a key of the front matter; it takes description, language, input, output',
      'Line 4, /config: config is not a key of the front matter; it takes description, language, input, output',
      'Line 5, /tools: tools is not a key of the front matter; it takes description, language, input, output',
      'Line 6, /input/default: default is not a key of input; it takes schema',
      'Line 7, /output/format: format is not a key of output; it takes schema',
    ]);
  });
});

describe('the values in the front matter of a computation function definition', () => {
  it('refuses a language other than jq, and a schema that is not a JSON Schema, with their line', () => {
    expect(
      issuesIn(
        programDocument(
          '.',
          'language: javascript\ninput:\n  schema: {type: object, properties: {a: {pattern: "x"}}}\noutput:\n  schema: {type: wrong}',
        ),
      ),
    ).toEqual([
      'Line 2, /language: javascript is not a language of a computation function; it is written in jq',
      'Line 4, /input/schema/properties/a/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
      'Line 6, /output/schema/type: Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
    ]);
  });

  it('is checked with the program, whose issues it reports beside its own', () => {
    expect(issuesIn(programDocument('now', 'language: jq\nsize: 2'))).toEqual([
      'Line 3, /size: size is not a key of the front matter; it takes description, language, input, output',
      'Line 5: now reads the clock, so the same input would not give the same output; pass the time in the input',
    ]);
    expect(issuesIn('---\nlanguage: [jq\n---\nnow')).toEqual([
      'Line 2: Flow sequence in block collection must be sufficiently indented and end with a ]',
      'Line 4: now reads the clock, so the same input would not give the same output; pass the time in the input',
    ]);
  });
});

describe('the program of a computation function definition', () => {
  it('is there', () => {
    expect(issuesIn(programDocument('\n  \n'))).toEqual([
      'Line 4: The definition has no program: write it after the front matter',
    ]);
  });

  it('compiles, and an issue in it is reported with its line in the document', () => {
    expect(issuesIn(programDocument('.rows\n| map(.a +)\n| add'))).toEqual(['Line 5: Unexpected token']);
    expect(issuesIn(programDocument('.rows\n| frobnicate'))).toEqual(['Line 5: Unknown function: frobnicate']);
    expect(issuesIn(programDocument('.rows\n| map($total)'))).toEqual([
      'Line 5: $total is not defined; bind it with as, reduce or foreach before using it',
    ]);
  });

  it.each(refusals)('refuses %s at save, with its line', (name, why, program) => {
    expect(issuesIn(programDocument(`.\n| ${program}`))).toContain(`Line 5: ${name} ${why}`);
  });

  it('refuses exactly the names the design of computation functions lists, and no other', () => {
    expect(computationDialect.refused.map(({ name }) => name).toSorted()).toEqual(
      refusals.map(([name]) => name).toSorted(),
    );
  });

  it('nests at most 128 levels, refused at save the same on any host', () => {
    expect(issuesIn(programDocument(`${'1+'.repeat(5000)}1`))).toEqual([
      'Line 4: The program nests more than 128 levels deep',
    ]);
    expect(issuesIn(programDocument(`.\n| ${'('.repeat(5000)}1${')'.repeat(5000)}`))).toEqual([
      'Line 5: The program nests more than 128 levels deep',
    ]);
  });

  it('compiles a program that raises only when it runs', () => {
    expect(issuesIn(programDocument('.a + 1'))).toEqual([]);
    expect(issuesIn(programDocument('error("not yet")'))).toEqual([]);
  });
});
