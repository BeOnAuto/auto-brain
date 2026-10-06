import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

await test('the install step defaults to Agent on the left with Manual on the right', () => {
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  const install = guide.split('## 1. Install Auto Brain')[1]?.split('## 2. Configure a model provider')[0];
  assert.ok(install !== undefined);
  const options = [...install.matchAll(/```(bash|text) \[(Manual|Agent)\]\n([\s\S]*?)```/gu)];
  assert.deepEqual(
    options.map((option: readonly string[]) => [option[1], option[2]]),
    [
      ['text', 'Agent'],
      ['bash', 'Manual'],
    ],
  );
  assert.equal(
    options[1]?.[3],
    'git clone https://github.com/BeOnAuto/auto-brain.git\ncd auto-brain\npnpm install\ncp .env.example .env\n',
  );
  const prompt = options[0]?.[3];
  assert.ok(prompt !== undefined);
  assert.ok(prompt.includes('Ask before installing prerequisites'));
  assert.equal(prompt.trimEnd().split('\n').length, 4);
  assert.ok(prompt.includes('keep existing files and .env'));
  assert.ok(prompt.includes('Never print secrets or ask for API keys in chat'));
  assert.ok(prompt.includes('Help configure my model provider'));
  assert.ok(prompt.includes('then show how to start the server'));
  assert.doesNotMatch(prompt, /Stop after install|mcp add/u);
  const html = readFileSync(join(docs, '.vitepress/dist/get-started/local.html'), 'utf8');
  const tabs = html.match(/class="vp-code-group[^"]*"[^>]*><div class="tabs">([\s\S]*?)<\/div>/u)?.[1];
  assert.ok(tabs !== undefined);
  assert.match(tabs, /<input[^>]* checked[^>]*><label[^>]*>Agent<\/label>/u);
  assert.match(tabs, /<input(?![^>]* checked)[^>]*><label[^>]*>Manual<\/label>/u);
});
