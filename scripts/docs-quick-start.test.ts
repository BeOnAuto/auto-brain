import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

await test('the local quick start connects an agent, checks it can see the models and leads to the first tutorial, and the README links to the documentation', () => {
  const readme = readFileSync(join(docs, '../README.md'), 'utf8');
  assert.ok(readme.includes('](https://on.auto/docs/)'));
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  assert.match(guide, /^# Quick start: connect your agent$/mu);
  assert.ok(guide.includes('Start Auto Runtime on your computer and connect Claude Code, Claude Desktop or Codex.'));
  const walkthrough = [
    'npx @on.auto/runtime\n',
    'http://localhost:5555/mcp',
    'Do not expose it through a tunnel or public proxy',
    'claude mcp add --transport http auto-runtime http://localhost:5555/mcp',
    'codex mcp add auto-runtime --url http://localhost:5555/mcp',
    'list my playbooks and the models this server can use',
    '## Next: your first playbook',
    '](../self-host/troubleshooting.md)',
    '## Run it for your team',
  ];
  assert.ok(guide.includes('it is not a model to run'));
  assert.ok(guide.includes('curl http://localhost:5555/health'));
  const positions = walkthrough.map((passage) => guide.indexOf(passage));
  assert.deepEqual(
    positions,
    positions.toSorted((earlier, later) => earlier - later),
  );
  assert.doesNotMatch(guide, /<details>|workspace's MCP URL|pnpm dev:lean|tool_servers/u);
  const setup = guide.slice(guide.indexOf('This setup'), guide.indexOf('## Run it for your team'));
  assert.ok(
    setup.startsWith('This setup is for macOS or Linux. You need [Node.js](https://nodejs.org/en/download) 26.10'),
  );
  assert.doesNotMatch(setup, /Auto Cloud|request-invite/iu);
  const team = guide.split('## Run it for your team')[1];
  assert.ok(team !== undefined);
  assert.ok(team.includes('](../self-host.md)'));
});

await test('the tool server page adds a server with its key kept out of the configuration file', () => {
  const guide = readFileSync(join(docs, 'self-host/tool-servers.md'), 'utf8');
  for (const passage of [
    'Create `auto-runtime.yaml` in the directory you start Auto Runtime in',
    'Authorization: Bearer ${SEARCH_API_KEY}',
    'The key never goes in `auto-runtime.yaml`',
    '](configuration.md#tool-servers)',
    '](../reference/reasoning-format.md#tools)',
  ])
    assert.ok(guide.includes(passage), `Missing from the tool server page: ${passage}`);
  const quickStart = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  assert.ok(quickStart.includes('](../guides/tools.md)'));
});
