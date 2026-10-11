import { beforeAll, describe, expect, it } from 'vitest';

import { compiledErrors, probeHeader, type RejectedProbe } from '../testing/compiled-probes.ts';

function definedOverHttp(kind: 'query' | 'command', lines: readonly string[]) {
  return [
    ...probeHeader,
    `export const probe = Operations.defineHttpOperation('brain', '${kind}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const emptyInputAndOutput = ['  inputSchema: Empty,', '  outputSchema: Empty,', '  reasons: [],'];

const answering = '  handle: () => Effect.succeed({}),';

const accepted: Readonly<Record<string, readonly string[]>> = {
  'http-command-answers-the-stream-it-takes.ts': definedOverHttp('command', [
    post,
    "  body: { kind: 'octet-stream', mostBytes: 64 },",
    ...emptyInputAndOutput,
    '  handle: (_input, body) => Effect.succeed(body),',
  ]),
  'http-query-takes-no-body.ts': definedOverHttp('query', [
    get,
    "  body: { kind: 'none' },",
    ...emptyInputAndOutput,
    answering,
  ]),
};

const rejected: Readonly<Record<string, RejectedProbe>> = {
  'http-query-takes-a-body.ts': {
    because: 'Type \'"csv"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('query', [
      get,
      "  body: { kind: 'csv', mostBytes: 64 },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'http-streamed-body-without-most-bytes.ts': {
    because: "Property 'mostBytes' is missing",
    source: definedOverHttp('command', [post, "  body: { kind: 'csv' },", ...emptyInputAndOutput, answering]),
  },
  'http-json-body-read-as-a-stream.ts': {
    because: "Type 'undefined' is not assignable to type 'StreamedContent'",
    source: definedOverHttp('command', [
      post,
      "  body: { kind: 'json' },",
      ...emptyInputAndOutput,
      '  handle: (_input, body) => Effect.succeed(body),',
    ]),
  },
};

describe('the compiler, given operations served over HTTP alone', () => {
  let errors: readonly string[] = [];

  beforeAll(() => {
    errors = compiledErrors('http-rules', { accepted, rejected });
  }, 60_000);

  it('accepts every body a definition may take and rejects every one it may not', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
