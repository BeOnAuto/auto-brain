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
];

const keptFolders: readonly string[] = ['docs/decisions/', 'patches/'];

const frozenFormats: readonly string[] = [
  ...['1', '2', '3', '4', '5', '6'].map((format) => `packages/workflow-engine/corpus/format-${format}.json`),
  ...['one', 'two', 'three', 'four', 'five', 'six'].map(
    (format) => `packages/workflow-engine/src/run-log/format-${format}.ts`,
  ),
  'packages/workflow-engine/src/run-log/format-one.test.ts',
  'packages/workflow-engine/src/run-log/format-four.test.ts',
];

const keptFiles: readonly string[] = ['pnpm-lock.yaml', 'scripts/docs-vocabulary.test.ts', ...frozenFormats];

interface Allowance {
  readonly text: string;
  readonly in?: string;
}

const internalTerms = 'packages/api/src/testing/internal-terms.ts';

const internalTermsTest = 'packages/api/src/testing/internal-terms.test.ts';

const allowances: readonly Allowance[] = [
  { text: 'https://open-workflow-specification.org/spec/1.0.0/errors' },
  { text: 'https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md' },
  { text: 'inferenceConfig' },
  { text: 'inferenceGeo' },
  { text: 'inference-profile' },
  { text: 'application inference profile' },
  { text: 'toolSpec' },
  { text: 'code_execution' },
  { text: 'execution-denied' },
  { text: 'graph/execute', in: 'docs/reference/reasoning-format.md' },
  ...['primitives?', 'executions?', 'inference', 'orchestration', 'recollection'].map((term) => ({
    text: String.raw`/\b${term}\b/iu`,
    in: internalTerms,
  })),
  ...[
    "['Created the inference spec.', 'spec']",
    "['The specs of the brain.', 'specs']",
    "['A primitive of the brain.', 'primitive']",
    "['The execution started.', 'execution']",
    "['It ran an inference.', 'inference']",
    "['An orchestration started.', 'orchestration']",
  ].map((leak) => ({ text: leak, in: internalTermsTest })),
  { text: "**inference** names a model call and its provider's terms", in: 'CLAUDE.md' },
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

const allowedOccurrences = new Map<Allowance, number>(allowances.map((allowance) => [allowance, 0]));

function maskedAllowances(path: string, text: string): string {
  return allowances
    .filter((allowance) => allowance.in === undefined || allowance.in === path)
    .reduce((masked, allowance) => {
      const pieces = masked.split(allowance.text);
      allowedOccurrences.set(allowance, (allowedOccurrences.get(allowance) ?? 0) + pieces.length - 1);
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

function placeOf(allowance: Allowance): string {
  return allowance.in === undefined ? allowance.text : `${allowance.in}: ${allowance.text}`;
}

const allowedButAbsent = allowances
  .filter((allowance) => allowedOccurrences.get(allowance) === 0)
  .map((allowance) => placeOf(allowance));

const leftOutButUntracked = keptFiles.filter((path) => !tracked.includes(path));

await test('no tracked file says an old word, outside the records, the lockfile, the patches and the frozen formats, but the texts it allows', () => {
  assert.deepEqual(findings, []);
});

await test('every text the search allows still occurs where it is allowed, and every file it leaves out is still tracked', () => {
  assert.deepEqual([...allowedButAbsent, ...leftOutButUntracked], []);
});
