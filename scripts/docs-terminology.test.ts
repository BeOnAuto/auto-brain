import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');
const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
const terminology = readFileSync(join(docs, 'concepts/terminology.md'), 'utf8');

await test('brain terminology distinguishes five function types from workflows', () => {
  const categories = [...functions.matchAll(/^## (Reasoning|Interaction|Prediction|Recall|Computation)$/gmu)].map(
    (match: readonly string[]) => match[1],
  );
  assert.deepEqual(categories, ['Reasoning', 'Interaction', 'Prediction', 'Recall', 'Computation']);
  assert.ok(readFileSync(join(docs, 'nav.json'), 'utf8').includes('"link": "/concepts/terminology"'));
  assert.ok(terminology.includes('There are six capabilities'));
  assert.ok(terminology.includes('`ReasoningFunctionDefinition`'));
  assert.ok(terminology.includes('`WorkflowDefinition`'));
  assert.ok(terminology.includes('Sending an approval or other input to a waiting run answers that run'));
});

await test('terminology distinguishes available and absent capabilities', () => {
  assert.ok(terminology.includes('This runtime repository has no Studio application'));
  assert.ok(terminology.includes('Self-hosted reasoning functions can use operator-configured MCP tools'));
  assert.ok(
    terminology.includes(
      'Auto Cloud tool access, skill references and a separately managed tool library are still planned',
    ),
  );
  assert.ok(terminology.includes('calling another workflow, or a subworkflow, is not supported yet'));
});
