import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

const oldWords: readonly string[] = [
  '[pP]rimitive|PRIMITIVE',
  '(?<![A-Za-z])[sS]pecs?(?![a-z])|(?<=[a-z])Specs?(?![a-z])|(?<![A-Za-z])SPECS?(?![A-Z])',
  '[eE]xecution|EXECUTION',
  '[iI]nference|INFERENCE',
  '[oO]rchestrat|ORCHESTRAT',
  '[rR]ecollection|RECOLLECTION',
  'execute_spec',
  String.raw`/execute\b`,
  '[eE]xecuteSpec',
  'language: jq',
  String.raw`evaluate\.language: jq`,
  'jq-ts',
];

const keptFolders: readonly string[] = ['docs/decisions/'];

const frozenFormats: readonly string[] = [
  ...['1', '2', '3', '4', '5', '6'].map((format) => `packages/workflow-engine/corpus/format-${format}.json`),
  ...['one', 'two', 'three', 'four', 'five', 'six'].map(
    (format) => `packages/workflow-engine/src/run-log/formats/format-${format}.ts`,
  ),
  'packages/workflow-engine/src/run-log/formats/format-six-records.ts',
  ...['one', 'two', 'four', 'six', 'six-records'].map(
    (format) => `packages/workflow-engine/src/run-log/formats/format-${format}.test.ts`,
  ),
];

const keptFiles: readonly string[] = ['pnpm-lock.yaml', 'scripts/docs-vocabulary.test.ts', ...frozenFormats];

interface Allowance {
  readonly text: string;
  readonly in: readonly string[];
}

const internalTerms = 'packages/api/src/testing/internal-terms.ts';

const internalTermsTest = 'packages/api/src/testing/internal-terms.test.ts';

const reasoningReference = 'docs/engineering/reference/reasoning-format.md';

const allowances: readonly Allowance[] = [
  {
    text: 'https://open-workflow-specification.org/spec/1.0.0/errors',
    in: [
      'capabilities/coordination/input-logs/retry-with-backoff.json',
      'capabilities/coordination/input-logs/timeout-fires.json',
      'capabilities/coordination/src/workflows/call-results.test.ts',
      'capabilities/coordination/src/workflows/error-tasks.test.ts',
      'docs/reference/workflow-format.md',
      'packages/server/src/computation/computation-workflows.test.ts',
      'packages/workflow-engine/corpus/format-7.json',
      'packages/workflow-engine/src/decider/open-calls.test.ts',
      'packages/workflow-engine/src/dsl/raised-error.test.ts',
      'packages/workflow-engine/src/dsl/raised-error.ts',
      'packages/workflow-engine/src/filters/event-filter.test.ts',
      'packages/workflow-engine/src/steps/step-causes.test.ts',
    ],
  },
  {
    text: 'https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md',
    in: ['docs/reference/http.md', 'packages/definitions/README.md'],
  },
  {
    text: 'inferenceConfig',
    in: [
      'capabilities/reasoning/src/adapter/cloud-providers.test.ts',
      'capabilities/reasoning/src/definition/definition-settings.test.ts',
      reasoningReference,
    ],
  },
  { text: 'inferenceGeo', in: ['capabilities/reasoning/src/model/offered-provider-options.ts', reasoningReference] },
  {
    text: 'inference-profile',
    in: [
      'capabilities/reasoning/src/catalog/catalog-leaks.test.ts',
      'capabilities/reasoning/src/catalog/catalog-listing.test.ts',
      'capabilities/reasoning/src/definition/definition-settings.test.ts',
      'capabilities/reasoning/src/settings/catalog-settings.test.ts',
    ],
  },
  { text: 'application inference profile', in: ['docs/engineering/self-host/models.md'] },
  { text: 'toolSpec', in: ['capabilities/reasoning/src/adapter/cloud-providers.test.ts'] },
  { text: 'code_execution', in: ['capabilities/reasoning/src/testing/model-lists.ts'] },
  { text: 'execution-denied', in: ['capabilities/reasoning/src/tools/final-step.test.ts'] },
  ...['primitives?', 'executions?', 'inference', 'orchestration', 'recollection'].map((term) => ({
    text: String.raw`/\b${term}\b/iu`,
    in: [internalTerms],
  })),
  ...[
    "['Created the inference spec.', 'spec']",
    "['The specs of the brain.', 'specs']",
    "['A primitive of the brain.', 'primitive']",
    "['The execution started.', 'execution']",
    "['It ran an inference.', 'inference']",
    "['An orchestration started.', 'orchestration']",
    "['It folds a recollection.', 'recollection']",
  ].map((leak) => ({ text: leak, in: [internalTermsTest] })),
  { text: "**inference** names a model call and its provider's terms", in: ['CLAUDE.md'] },
  {
    text: 'toPrimitive',
    in: ['packages/definitions/lib/sandbox.d.ts.txt', 'packages/workflow-engine/src/programs/sandbox-prelude.ts'],
  },
];

const textOnly = new TextDecoder('utf-8', { fatal: true });

function textOf(path: string): string | undefined {
  try {
    return textOnly.decode(readFileSync(join(root, path)));
  } catch {
    return undefined;
  }
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((path) => path !== '');

const searched = tracked.filter(
  (path) =>
    !keptFolders.some((folder) => path.startsWith(folder)) &&
    !keptFiles.includes(path) &&
    existsSync(join(root, path)) &&
    !lstatSync(join(root, path)).isSymbolicLink(),
);

function placeOf(allowance: Allowance, path: string): string {
  return `${path}: ${allowance.text}`;
}

const allowedOccurrences = new Map<string, number>();

function maskedAllowances(path: string, text: string): string {
  return allowances
    .filter((allowance) => allowance.in.includes(path))
    .reduce((masked, allowance) => {
      const pieces = masked.split(allowance.text);
      const place = placeOf(allowance, path);
      allowedOccurrences.set(place, (allowedOccurrences.get(place) ?? 0) + pieces.length - 1);
      return pieces.join(' '.repeat(allowance.text.length));
    }, text);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

interface Found {
  readonly index: number;
  readonly word: string;
}

function foundIn(masked: string, word: string): readonly Found[] {
  const found: Found[] = [];
  for (const match of masked.matchAll(new RegExp(word, 'gu'))) {
    found.push({ index: match.index, word: match[0] });
  }
  return found;
}

function oldWordsIn(path: string, text: string): readonly string[] {
  const masked = maskedAllowances(path, text);
  const found = oldWords
    .flatMap((word) => foundIn(masked, word))
    .toSorted((one, other) => one.index - other.index)
    .map(({ index, word }) => `${path}:${lineAt(masked, index)}: ${word}`);
  return [...new Set(found)];
}

const findings = searched.flatMap((path) => {
  const text = textOf(path);
  return text === undefined ? [] : oldWordsIn(path, text);
});

const allowedButAbsent = allowances
  .flatMap((allowance) => allowance.in.map((path) => placeOf(allowance, path)))
  .filter((place) => (allowedOccurrences.get(place) ?? 0) === 0);

const leftOutButUntracked = keptFiles.filter((path) => !tracked.includes(path));

const pagesOfTheGuides = /^docs\/(?:reference|concepts|tutorials)\/.*\.md$/u;

const oldLanguageOnPages = tracked
  .filter((path) => pagesOfTheGuides.test(path))
  .flatMap((path) =>
    foundIn(textOf(path) ?? '', String.raw`\bjq\b`).map(({ index }) => `${path}:${lineAt(textOf(path) ?? '', index)}`),
  );

await test('no tracked file says an old word, outside the records, the lockfile and the frozen formats, but the texts it allows', () => {
  assert.deepEqual(findings, []);
});

await test('no page of the reference, the concepts or the tutorials, the pages the brain serves as its guides, names the language it no longer runs', () => {
  assert.deepEqual(oldLanguageOnPages, []);
});

await test('every text the search allows still occurs in each file it is allowed in, and every file it leaves out is still tracked', () => {
  assert.deepEqual([...allowedButAbsent, ...leftOutButUntracked], []);
});
