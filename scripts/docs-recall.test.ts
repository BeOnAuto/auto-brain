import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

await test('recall functions are available in a self-hosted runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const history = readFileSync(join(docs, 'concepts/history-and-dream.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/recall-format.md'), 'utf8');
  assert.match(functions, /\| Recall +\| A recall function +\| Available in a self-hosted runtime +\|/u);
  assert.ok(functions.includes('](../reference/recall-format.md)'));
  assert.ok(history.includes('A self-hosted runtime runs recall functions'));
  assert.ok(routes.indexOf('/reference/computation-format') < routes.indexOf('/reference/recall-format'));
  assert.ok(routes.indexOf('/reference/recall-format') < routes.indexOf('/reference/workflow-format'));
  assert.ok(format.includes('Auto Cloud does not offer them until it bounds their time and memory'));
  assert.ok(format.includes('A run never waits for the view'));
});
