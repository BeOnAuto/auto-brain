import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');
const output = join(docs, '.vitepress/dist');
const markdownDestinations = (source: string): readonly string[] =>
  [...source.matchAll(/\]\(([^)]+)\)/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined);
const navigation = readFileSync(join(docs, 'nav.json'), 'utf8');
const pages = readdirSync(docs, { recursive: true, withFileTypes: true })
  .filter(
    (entry: Readonly<Dirent>) =>
      entry.isFile() && entry.name.endsWith('.md') && !entry.parentPath.includes('.vitepress'),
  )
  .map((entry: Readonly<Dirent>) => join(entry.parentPath, entry.name));
const repositoryOnlyDirectories = ['decisions', 'engineering'];
const publicPages = pages.filter(
  (page) => !repositoryOnlyDirectories.some((directory) => relative(docs, page).startsWith(`${directory}/`)),
);
const routes = [...navigation.matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);
const navigationGroups = [...navigation.matchAll(/"text"\s*:\s*"([^"]+)"\s*,\s*"items"\s*:/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((group) => group !== undefined);
const guides = publicPages.filter((page) => page !== join(docs, 'index.md'));
const renderedPages = publicPages.map((page) => {
  const filename = relative(docs, page).replace(/\.md$/u, '.html');
  return { page, filename, html: readFileSync(join(output, filename), 'utf8') };
});
const localLinks = renderedPages.flatMap(({ filename, html }: Readonly<{ filename: string; html: string }>) =>
  [...html.matchAll(/<a\s[^>]*href="([^"\s]+)"/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined)
    .filter((href) => href.startsWith('/docs/') || href.startsWith('#'))
    .map((href) => {
      const url = new URL(href, `https://preview.test/docs/${filename}`);
      const path = decodeURIComponent(url.pathname).replace(/^\/docs\//u, '');
      const target = path.endsWith('/') || path === '' ? `${path}index.html` : `${path.replace(/\.html$/u, '')}.html`;
      return { filename, href, target, fragment: decodeURIComponent(url.hash.slice(1)) };
    }),
);
const fragmentLinks = localLinks.filter(({ fragment }: Readonly<{ fragment: string }>) => fragment !== '');
const markdownLinks = publicPages.flatMap((page) =>
  [...readFileSync(page, 'utf8').matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((href) => href !== undefined)
    .filter((href) => !/^https?:/u.test(href))
    .map((href) => ({ page, href, target: resolve(dirname(page), href) })),
);

await test('navigation has unique routes and points to source pages', () => {
  assert.equal(routes.length, new Set(routes).size);
  for (const route of routes) {
    assert.match(route, /^\/(?!docs\/)[a-z0-9/-]+$/u);
    assert.ok(existsSync(join(docs, `${route}.md`)), `Navigation target missing: ${route}`);
  }
});

await test('navigation covers every guide and source pages have titles', () => {
  for (const page of publicPages) assert.match(readFileSync(page, 'utf8'), /^# .+/mu, `${page} needs a title`);
  for (const page of guides) {
    const route = `/${relative(docs, page).replace(/\.md$/u, '')}`;
    assert.ok(routes.includes(route), `Guide missing from navigation: ${route}`);
  }
});

await test('the public preview builds all pages with public edit links and a documentation base', () => {
  for (const { page, filename, html } of renderedPages) {
    assert.ok(html.includes('/docs/assets/'), `${filename} assets need the documentation base`);
    assert.ok(
      html.includes(`https://github.com/BeOnAuto/auto-brain/edit/main/docs/${relative(docs, page)}`),
      `${filename} needs a public source edit link`,
    );
  }
});

await test('rendered local navigation resolves', () => {
  for (const { target, filename, href } of localLinks) {
    assert.ok(existsSync(join(output, target)), `${filename} links to missing page ${href}`);
  }
});

await test('rendered fragment links resolve', () => {
  for (const { target, fragment, filename, href } of fragmentLinks) {
    const html = readFileSync(join(output, target), 'utf8');
    assert.ok(html.includes(`id="${fragment}"`), `${filename} links to missing anchor ${href}`);
  }
});

await test('guide Markdown does not depend on private source files', () => {
  for (const { target, page, href } of markdownLinks) {
    assert.ok(target.startsWith(`${docs}/`), `${page} escapes documentation source: ${href}`);
    assert.ok(existsSync(target), `${page} links to missing Markdown: ${href}`);
    assert.ok(publicPages.includes(target), `${page} links to an unpublished source page: ${href}`);
  }
});

await test('engineering guides and decisions remain in the repository without entering the public preview', () => {
  assert.ok(pages.includes(join(docs, 'decisions/README.md')));
  assert.ok(pages.includes(join(docs, 'engineering/index.md')));
  assert.ok(pages.includes(join(docs, 'engineering/self-host/workflows.md')));
  assert.ok(pages.includes(join(docs, 'engineering/reference/workflow-format.md')));
  for (const directory of repositoryOnlyDirectories) {
    assert.equal(existsSync(join(output, directory)), false);
    assert.equal(
      routes.some((route) => route.startsWith(`/${directory}/`)),
      false,
    );
    for (const { html } of renderedPages) assert.equal(html.includes(`href="/docs/${directory}/`), false);
  }
});

await test('public docs offer a local learning path and one self-hosting services overview', () => {
  const selfHostPages = publicPages.filter((page) => relative(docs, page).startsWith('self-host'));
  assert.deepEqual(selfHostPages, [join(docs, 'self-host.md')]);
  const selfHost = readFileSync(join(docs, 'self-host.md'), 'utf8');
  assert.ok(selfHost.includes('[Xolvio Professional Services](https://www.xolv.io/contact-us)'));
  assert.ok(markdownDestinations(selfHost).includes('get-started/local.md'));
  assert.ok(selfHost.includes('Auto Cloud is coming soon'));
  const index = readFileSync(join(docs, 'index.md'), 'utf8');
  const destinations = markdownDestinations(index);
  assert.ok(destinations.includes('get-started/local.md'));
  assert.ok(destinations.includes('self-host.md'));
  assert.ok(destinations.indexOf('get-started/local.md') < destinations.indexOf('self-host.md'));
  for (const { html } of renderedPages) assert.doesNotMatch(html, /temporal/iu);
  for (const page of publicPages) assert.doesNotMatch(readFileSync(page, 'utf8'), /temporal/iu);
});

await test('documentation link checks compare the complete Markdown destination', () => {
  const expected = 'https://on.auto/docs/get-started/cloud';
  assert.deepEqual(markdownDestinations(`[Connect](${expected})`), [expected]);
  const misleading = [
    `[Wrong host](https://on.auto.example.test/docs/get-started/cloud)`,
    `[Wrong path](https://example.test/${expected})`,
    `[Unrelated text](https://example.test/) ${expected}`,
  ];
  for (const source of misleading) {
    assert.equal(
      markdownDestinations(source).some((href) => href === expected),
      false,
    );
  }
});

await test('navigation separates concepts, learning, guides and reference', () => {
  assert.deepEqual(navigationGroups, [
    'Concepts',
    'Get started',
    'Guides',
    'Self-hosting',
    'Reference',
    'Contributing',
  ]);
  assert.ok(routes.includes('/tutorials/first-brain'));
  assert.ok(routes.indexOf('/get-started/local') < routes.indexOf('/tutorials/first-brain'));
  assert.ok(navigation.includes('Deployment and support'));
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  assert.match(mcp, /^# MCP reference/mu);
  assert.ok(mcp.includes('../tutorials/first-brain.md'));
  assert.doesNotMatch(mcp, /Given what you know about my work|## Start with work/u);
});

await test('the first-brain tutorial supplies inputs and observable checks for two runs', () => {
  const tutorial = readFileSync(join(docs, 'tutorials/first-brain.md'), 'utf8');
  const inputs = [...tutorial.matchAll(/```text\n([\s\S]*?)```/gu)].map((match: readonly string[]) => match[1]);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0]?.includes('Total budget: USD 8,000'), true);
  assert.equal(inputs[0]?.includes('Success measure: Generate interest in the product'), true);
  assert.equal(inputs[1]?.includes('Finance directors at UK manufacturing companies'), true);
  assert.equal(inputs[1]?.includes('Success measure: 100 trial registrations'), true);
  assert.ok(markdownDestinations(tutorial).includes('../get-started/local.md'));
  assert.ok(tutorial.includes('You do not need an Auto Cloud account'));
  assert.ok(tutorial.includes('review-campaign-brief'));
  assert.ok(tutorial.includes('USD 10,000'));
  assert.ok(tutorial.includes('status: succeeded'));
  assert.ok(tutorial.includes('different execution ids'));
  assert.ok(tutorial.includes('same definition version'));
  assert.doesNotMatch(tutorial, /localhost|127\.0\.0\.1|claude-|gpt-/u);
});

await test('the README starts with an actionable local quick start and keeps Cloud optional', () => {
  const readme = readFileSync(join(docs, '../README.md'), 'utf8');
  assert.ok(readme.indexOf('## Quick start') < readme.indexOf('## Documentation and help'));
  assert.ok(readme.includes('You do not need an Auto Cloud account'));
  assert.ok(readme.includes('Run the saved function on:'));
  assert.ok(readme.includes('recorded run, including its execution id'));
  assert.ok(readme.includes('missing measurable goal'));
  assert.doesNotMatch(readme, /<details>|workspace's MCP URL/u);
  assert.ok(readme.includes('pnpm dev\n'));
  assert.equal(readme.includes('pnpm dev:lean'), false);
  assert.ok(readme.includes('http://localhost:8080/mcp'));
  assert.ok(readme.includes('curl http://localhost:8080/health'));
  assert.ok(readme.includes('do not expose it through a tunnel or public proxy'));
  assert.ok(readme.includes('Claude Code, Claude Desktop or Codex'));
  assert.ok(readme.includes('claude mcp add --transport http auto-brain http://localhost:8080/mcp'));
  assert.ok(readme.includes('codex mcp add auto-brain --url http://localhost:8080/mcp'));
  assert.ok(readme.indexOf('pnpm dev') < readme.indexOf('## Hosted brains'));
  assert.ok(readme.includes('Auto Cloud is coming soon'));
  assert.ok(readme.includes('You can also host your own brain'));
  assert.ok(markdownDestinations(readme).some((href) => href === 'https://on.auto/docs/self-host'));
  assert.ok(markdownDestinations(readme).some((href) => href === 'https://on.auto/request-invite'));
});

await test('the local quick start gives runnable setup and distinguishes local clients from Cloud', () => {
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  for (const command of [
    'git clone https://github.com/BeOnAuto/auto-brain.git',
    'pnpm install',
    'cp .env.example .env',
    'pnpm dev',
    'curl http://localhost:8080/health',
    'claude mcp add --transport http auto-brain http://localhost:8080/mcp',
    'codex mcp add auto-brain --url http://localhost:8080/mcp',
  ])
    assert.ok(guide.includes(command), `Missing quick-start command: ${command}`);
  assert.ok(guide.includes('ANTHROPIC_API_KEY'));
  assert.ok(guide.includes('OPENAI_API_KEY'));
  assert.ok(guide.includes('GOOGLE_GENERATIVE_AI_API_KEY'));
  assert.ok(guide.includes("Your agent's subscription does not supply the server's model credentials"));
  assert.ok(guide.includes('Claude Desktop'));
  assert.ok(guide.includes('This setup is for macOS or Linux'));
  assert.ok(guide.includes('## 4. Connect your agent {#connect-your-agent}'));
  assert.ok(guide.includes('third-party'));
  assert.ok(guide.includes("remote connector runs from Anthropic's servers"));
  assert.ok(guide.includes('Do not expose it through a tunnel or public proxy'));
  assert.match(guide, /::: info Auto Cloud\n.*invite-only.*request-invite.*\n:::\n\nThis setup/u);
  assert.doesNotMatch(guide, /Auto Cloud is coming soon|You do not need an Auto Cloud account/u);
  assert.ok(guide.includes('## Hosted brains'));
  assert.doesNotMatch(guide, /Prefer a hosted brain/u);
  assert.ok(guide.includes('You can also host your own brain'));
  assert.ok(markdownDestinations(guide).includes('../self-host.md'));
  assert.ok(markdownDestinations(guide).some((href) => href === 'https://on.auto/request-invite'));
  assert.ok(markdownDestinations(guide).includes('../tutorials/first-brain.md'));
  const configBlock = [...guide.matchAll(/```json\n([\s\S]*?)```/gu)].at(0)?.[1];
  assert.notEqual(configBlock, '');
  assert.ok(configBlock !== undefined);
  const config: unknown = JSON.parse(configBlock);
  assert.deepEqual(config, {
    mcpServers: {
      'auto-brain': {
        command: 'npx',
        args: ['-y', 'mcp-remote@0.14.3', 'http://localhost:8080/mcp', '--allow-http', '--transport', 'http-only'],
      },
    },
  });
});

await test('model discovery is documented without treating wildcard entries as runnable models', () => {
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  const http = readFileSync(join(docs, 'reference/http.md'), 'utf8');
  const tutorial = readFileSync(join(docs, 'tutorials/first-brain.md'), 'utf8');
  assert.ok(mcp.includes('`list_models`'));
  assert.ok(mcp.includes('requires `org:read`'));
  assert.ok(mcp.includes('not available on a brain-scoped endpoint'));
  assert.ok(mcp.includes('`catalog_status: "partial"`'));
  assert.ok(mcp.includes('not a model to run'));
  assert.ok(http.includes('GET /v1/orgs/{org}/models'));
  assert.ok(tutorial.includes('model reference that your configured provider can use'));
  assert.ok(tutorial.includes('Do not use a wildcard'));
});

await test('public workflows are available and link their format and tutorial, while the runnable walkthroughs stay out of the public routes', () => {
  const workflows = readFileSync(join(docs, 'concepts/workflows.md'), 'utf8');
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const tutorial = readFileSync(join(docs, 'tutorials/first-workflow.md'), 'utf8');
  assert.doesNotMatch(workflows, /coming soon/iu);
  assert.ok(functions.includes('Workflows are available and coordinate the functions above'));
  for (const page of publicPages) assert.doesNotMatch(readFileSync(page, 'utf8'), /workflow service/iu);
  assert.doesNotMatch(workflows, /```(?:yaml|sh|bash|json)/u);
  assert.ok(markdownDestinations(workflows).includes('../reference/workflow-format.md'));
  assert.ok(markdownDestinations(workflows).includes('../tutorials/first-workflow.md'));
  assert.ok(routes.includes('/reference/workflow-format'));
  assert.ok(routes.includes('/tutorials/first-workflow'));
  assert.ok(tutorial.includes('send_execution_event'));
  assert.ok(tutorial.includes('status: succeeded'));
  assert.doesNotMatch(tutorial, /localhost|127\.0\.0\.1|claude-|gpt-/u);
  const removedPages = ['get-started/self-hosted', 'reference/http-tutorial'];
  for (const page of removedPages) {
    assert.equal(routes.includes(`/${page}`), false);
    assert.equal(existsSync(join(output, `${page}.html`)), false);
  }
});

await test('computation functions are available in a self-hosted runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/computation-format.md'), 'utf8');
  assert.match(functions, /\| Computation +\| A computation function +\| Available in a self-hosted runtime +\|/u);
  assert.ok(markdownDestinations(functions).includes('../reference/computation-format.md'));
  assert.ok(routes.indexOf('/reference/reasoning-format') < routes.indexOf('/reference/computation-format'));
  assert.ok(routes.indexOf('/reference/computation-format') < routes.indexOf('/reference/workflow-format'));
  assert.ok(format.includes('Auto Cloud does not offer them yet'));
  assert.ok(format.includes('compute money in whole minor units'));
  for (const page of publicPages) assert.doesNotMatch(readFileSync(page, 'utf8'), /compute functions?\b/iu);
});
