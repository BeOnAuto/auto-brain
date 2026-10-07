import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

await test('the local quick start connects an agent and runs a first function with Cloud optional, and the README links to the documentation', () => {
  const readme = readFileSync(join(docs, '../README.md'), 'utf8');
  assert.ok(readme.includes('](https://on.auto/docs/)'));
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  assert.match(guide, /^# Quick start: connect your agent$/mu);
  assert.ok(guide.includes('Start Auto Brain on your computer and connect Claude Code, Claude Desktop or Codex.'));
  const walkthrough = [
    'pnpm dev\n',
    'curl http://localhost:8080/health',
    'http://localhost:8080/mcp',
    'Do not expose it through a tunnel or public proxy',
    'claude mcp add --transport http auto-brain http://localhost:8080/mcp',
    'codex mcp add auto-brain --url http://localhost:8080/mcp',
    'Create a brain named Quickstart with id quickstart',
    'reasoning function called check-brief',
    'ask it to run the saved function on:',
    'Promote our reporting tool to finance teams with a USD 5,000 budget.',
    'the recorded run, including its execution id',
    'missing measurable goal',
    '## Hosted brains',
  ];
  for (const passage of walkthrough) assert.ok(guide.includes(passage), `Missing from the quick start: ${passage}`);
  const positions = walkthrough.map((passage) => guide.indexOf(passage));
  assert.deepEqual(
    positions,
    positions.toSorted((earlier, later) => earlier - later),
  );
  assert.doesNotMatch(guide, /<details>|workspace's MCP URL|pnpm dev:lean/u);
  const setup = guide.slice(guide.indexOf('This setup'), guide.indexOf('## Hosted brains'));
  assert.ok(setup.startsWith('This setup is for macOS or Linux. You need [Git]'));
  assert.doesNotMatch(setup, /Auto Cloud|request-invite|account/iu);
  const hosted = guide.split('## Hosted brains')[1];
  assert.ok(hosted !== undefined);
  assert.ok(hosted.includes('Auto Cloud is currently invite-only'));
  assert.ok(hosted.includes('You can also host your own brain'));
  assert.ok(hosted.includes('](https://on.auto/request-invite)'));
  assert.ok(hosted.includes('](../self-host.md)'));
});
