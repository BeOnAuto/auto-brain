import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');
const output = join(docs, '.vitepress/dist');
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
  assert.ok(terminology.includes('`BrainFunctionDefinition`'));
  assert.ok(terminology.includes('`FunctionRun` and `WorkflowRun`'));
  assert.ok(terminology.includes('`ReasoningFunctionDefinitionDocument` or `WorkflowDefinitionDocument`'));
  assert.ok(terminology.includes('`makeReasoningFunctionAdapter` and `makeWorkflowAdapter`'));
  assert.ok(terminology.includes('Sending an approval or other input to a waiting run answers that run'));
});

await test('terminology distinguishes current contracts and absent capabilities', () => {
  assert.ok(terminology.includes('`primitive: "inference"`'));
  assert.ok(terminology.includes('`primitive: "orchestration"`'));
  assert.ok(terminology.includes('This runtime repository has no Studio application'));
  assert.ok(terminology.includes('Self-hosted reasoning functions can use operator-configured MCP tools'));
  assert.ok(
    terminology.includes(
      'Auto Cloud tool access, skill references and a separately managed tool library are still planned',
    ),
  );
  assert.ok(terminology.includes('calling another workflow, or a subworkflow, is not supported yet'));
});

await test('renamed documentation headings preserve existing fragment links', () => {
  const fragments = [
    ['concepts/functions.html', 'tool-access-inside-a-reason-function'],
    ['reference/http.html', 'reason-functions'],
    ['reference/reasoning-format.html', 'reason-function-format'],
    ['tutorials/first-workflow.html', '_2-confirm-the-reason-function'],
  ];
  for (const [page, fragment] of fragments) {
    assert.ok(page !== undefined);
    assert.ok(fragment !== undefined);
    assert.ok(readFileSync(join(output, page), 'utf8').includes(`id="${fragment}"`));
  }
});
