import { issueText } from '@beonauto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, recallDocument } from '../testing/campaign-reviews.ts';
import { parseRecallDocument } from './document-parsing.ts';
import type { RecallFunctionDefinitionDocument } from './recall-document.ts';

const succeeded = 'language: jq\nsource:\n  events:\n    - type: run_succeeded';

function parsed(source: string): RecallFunctionDefinitionDocument {
  return Result.getOrThrow(parseRecallDocument(source));
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseRecallDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a recall function definition', () => {
  it('is front matter of the keys of a reason function that apply, language, source, view and answer, and a fold as its body', () => {
    const document = parsed(campaignReviews);

    expect(document).toMatchObject({
      description: 'The reviews of each campaign, latest last, as the review-brief function wrote them',
      language: 'jq',
      input: { schema: { document: { type: 'object', required: ['campaign'] } } },
      output: { schema: { document: { type: 'array' } } },
      answer: { source: '.[$input.campaign] // [] | .[-($input.last // 5):]', line: 25 },
    });
    expect(document.details).toEqual({
      language: 'jq',
      fold: campaignReviews.split('---\n')[2],
      foldLine: 27,
      answer: '.[$input.campaign] // [] | .[-($input.last // 5):]',
      filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
      initial: {},
      schema: { type: 'object', maxProperties: 50, additionalProperties: { type: 'array', maxItems: 20 } },
    });
  });

  it('needs only a language, the events it folds and a fold, and starts its view at null', () => {
    expect(parsed(recallDocument('. + 1'))).toEqual({
      language: 'jq',
      input: {},
      output: {},
      details: {
        language: 'jq',
        fold: '. + 1',
        foldLine: 7,
        filters: [{ type: 'run_succeeded' }],
        initial: null,
      },
    });
  });
});

describe('the front matter of a recall function definition', () => {
  it('names at least the language and the events it folds, and opens the document', () => {
    expect(issuesIn(recallDocument('.', '# nothing'))).toEqual([
      'Line 2: The front matter is empty; it names at least the language and the events it folds',
    ]);
    expect(issuesIn('. + 1')).toEqual([
      'Line 1: A recall function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(issuesIn(recallDocument('.', 'language: jq'))).toEqual(['Line 2, /source: source is required']);
    expect(issuesIn(recallDocument('.', 'source: {events: [{type: x}]}'))).toEqual([
      'Line 2, /language: language is required',
    ]);
  });

  it('refuses the keys of a reason function that do not apply, as keys it does not take', () => {
    const front = `${succeeded}\nmodel: anthropic/claude-sonnet-4-5\nconfig: {temperature: 0}\ntools: [graph/*]\ninput: {default: {}}\noutput: {format: json}\nview: {limit: 3}\nsource2: x`;

    expect(issuesIn(recallDocument('.', front))).toEqual([
      'Line 6, /model: model is not a key of the front matter; it takes description, language, source, view, input, output, answer',
      'Line 7, /config: config is not a key of the front matter; it takes description, language, source, view, input, output, answer',
      'Line 8, /tools: tools is not a key of the front matter; it takes description, language, source, view, input, output, answer',
      'Line 9, /input/default: default is not a key of input; it takes schema',
      'Line 10, /output/format: format is not a key of output; it takes schema',
      'Line 11, /view/limit: limit is not a key of view; it takes initial, schema',
      'Line 12, /source2: source2 is not a key of the front matter; it takes description, language, source, view, input, output, answer',
    ]);
  });

  it('refuses a language other than jq, and a schema that is not a JSON Schema, with their line', () => {
    const front =
      'language: javascript\nsource:\n  events:\n    - type: x\ninput:\n  schema: {type: object, properties: {a: {pattern: "x"}}}\noutput:\n  schema: {type: wrong}\nview:\n  schema: {minimum: 1}';

    expect(issuesIn(recallDocument('.', front))).toEqual([
      'Line 2, /language: javascript is not a language of a recall function; it is written in jq',
      'Line 7, /input/schema/properties/a/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
      'Line 9, /output/schema/type: Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
    ]);
  });
});

describe('the view of a recall function definition', () => {
  it('starts at an initial value that fits its bounds and its schema', () => {
    const deep = `${'['.repeat(80)}${']'.repeat(80)}`;
    const large = `"${'x'.repeat(600_000)}"`;

    expect(issuesIn(recallDocument('.', `${succeeded}\nview: {initial: ${deep}}`))).toEqual([
      `Line 6, /view/initial${'/0'.repeat(71)}: The front matter may nest at most 72 levels`,
    ]);
    expect(issuesIn(recallDocument('.', `${succeeded}\nview: {initial: ${large}}`))).toEqual([
      'Line 6, /view/initial: initial takes 600002 bytes as JSON, more than the 524288 a view may',
    ]);
    expect(issuesIn(recallDocument('.', `${succeeded}\nview: {initial: [1], schema: {type: object}}`))).toEqual([
      "Line 6, /view/initial: initial does not match the view's schema at its root: Expected object",
    ]);
    expect(
      issuesIn(recallDocument('.', `${succeeded}\nview: {initial: {a: 1}, schema: {properties: {a: {type: string}}}}`)),
    ).toEqual(["Line 6, /view/initial: initial does not match the view's schema at /a: Expected string"]);
  });

  it('starts at a value JSON can hold', () => {
    expect(issuesIn(recallDocument('.', `${succeeded}\nview: {initial: .nan}`))).toEqual([
      'Line 6, /view/initial: Expected text, a finite number, true, false or null',
    ]);
  });
});

describe('the fold of a recall function definition', () => {
  it('is there', () => {
    expect(issuesIn(recallDocument('\n  \n'))).toEqual([
      'Line 7: The definition has no fold: write it after the front matter',
    ]);
  });

  it('compiles, and an issue in it is reported with its line in the document, beside the issues of the front matter', () => {
    expect(issuesIn(recallDocument('.\n| map(.a +)'))).toEqual(['Line 8: Unexpected token']);
    expect(issuesIn(recallDocument('.\n| frobnicate'))).toEqual(['Line 8: Unknown function: frobnicate']);
    expect(issuesIn(recallDocument('now', `${succeeded}\nsize: 2`))).toEqual([
      'Line 6, /size: size is not a key of the front matter; it takes description, language, source, view, input, output, answer',
      'Line 8: now reads the clock, so the same events would not fold to the same view; read the time of an event as $event.time',
    ]);
    expect(issuesIn('---\nlanguage: [jq\n---\nnow')).toEqual([
      'Line 2: Flow sequence in block collection must be sufficiently indented and end with a ]',
      'Line 4: now reads the clock, so the same events would not fold to the same view; read the time of an event as $event.time',
    ]);
  });

  it('reads the event as $event, and no input and no arguments', () => {
    expect(issuesIn(recallDocument('. + [$event.data]'))).toEqual([]);
    expect(issuesIn(recallDocument('. + [$input]'))).toEqual([
      'Line 7: $input is not defined; bind it with as, reduce or foreach before using it',
    ]);
    expect(issuesIn(recallDocument('$ARGS'))).toEqual([
      'Line 7: $ARGS reads arguments a recall function is never given; the fold reads $event and the answer $input',
    ]);
  });
});

function answering(answer: string): string {
  return recallDocument('.', `${succeeded}\nanswer: '${answer}'`);
}

describe('the answer of a recall function definition', () => {
  it('reads the run input as $input, and no event and no arguments, refused with its line', () => {
    expect(issuesIn(answering('.[$input.campaign]'))).toEqual([]);
    expect(issuesIn(answering('. + $event'))).toEqual([
      'Line 6, /answer: $event is not defined; bind it with as, reduce or foreach before using it',
    ]);
    expect(issuesIn(answering('$ARGS'))).toEqual([
      'Line 6, /answer: $ARGS reads arguments a recall function is never given; the fold reads $event and the answer $input',
    ]);
    expect(issuesIn(answering('.[('))).toEqual(['Line 6, /answer: Unexpected token']);
  });

  it('is an expression, not an empty text', () => {
    expect(issuesIn(answering(''))).toEqual(['Line 6, /answer: Expected a value with a length of at least 1']);
  });
});
