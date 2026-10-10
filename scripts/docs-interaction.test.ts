import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

const unansweredType = new URL('https://on.auto/problems/unanswered');

const markdownDestinations = (source: string): readonly string[] =>
  [...source.matchAll(/\]\(([^)]+)\)/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined);

const urlsInCode = (source: string): readonly string[] =>
  [...source.matchAll(/`([^`\n]+)`/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((span) => span !== undefined && URL.canParse(span))
    .map((span) => new URL(String(span)).href);

await test('interaction functions are available in a self-hosted runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/interaction-format.md'), 'utf8');
  assert.match(functions, /\| Interaction +\| An interaction function +\| Available in a self-hosted runtime +\|/u);
  assert.ok(markdownDestinations(functions).some((href) => href === '../reference/interaction-format.md'));
  assert.ok(routes.indexOf('/reference/reasoning-format') < routes.indexOf('/reference/interaction-format'));
  assert.ok(routes.indexOf('/reference/interaction-format') < routes.indexOf('/reference/computation-format'));
  assert.ok(urlsInCode(format).some((href) => href === unansweredType.href));
  assert.match(
    format,
    /^## Asking a system\n[\s\S]*^## Sending through a tool\n[\s\S]*^### Attempts\n[\s\S]*^## Fields$/mu,
  );
  assert.match(format, /^\| `call` +\| The tool the function asks: /mu);
  assert.match(format, /^\| `deliver` +\| The tool the request is sent through: /mu);
  assert.match(format, /^### Answering by reply$/mu);
});

await test('the words of interaction are on the terminology page, and the first workflow asks through the inbox', () => {
  const terminology = readFileSync(join(docs, 'concepts/terminology.md'), 'utf8');
  const tutorial = readFileSync(join(docs, 'tutorials/first-workflow.md'), 'utf8');
  const workflows = readFileSync(join(docs, 'concepts/workflows.md'), 'utf8');
  for (const term of ['Request', 'Inbox', 'Delivery', 'Answer', 'Notification']) {
    assert.match(terminology, new RegExp(`^\\| ${term} +\\| `, 'mu'), `The terminology page needs ${term}`);
  }
  assert.ok(
    terminology.includes(
      'An interaction function asks a system and answers at once, or asks a person and takes the answer later',
    ),
  );
  assert.ok(!tutorial.includes('deliver:'));
  assert.ok(tutorial.includes('answer_interaction'));
  assert.ok(workflows.includes('An approval is an interaction function'));
});
