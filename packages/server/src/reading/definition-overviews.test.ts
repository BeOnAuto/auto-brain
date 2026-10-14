import { withMcpSession } from '@on.auto/api/testing';
import { campaignPace } from '@on.auto/computation/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { weeklyOrders } from '@on.auto/prediction/testing';
import { campaignReviews } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const [reasoningExample] = blocksInOrderOf('reference/reasoning-format.md');

const [, , , readCampaignCosts] = blocksInOrderOf('reference/computation-format.md');

const greet =
  "document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: greet\n  version: '1.0.0'\ndo:\n  - greet: { set: { greeting: hello } }\n";

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const saved: readonly Saved[] = [
  { type: 'reasoning', name: 'review-brief', source: String(reasoningExample?.body) },
  { type: 'interaction', name: 'read-campaign-costs', source: String(readCampaignCosts?.body) },
  { type: 'prediction', name: 'weekly-orders', source: weeklyOrders },
  { type: 'recall', name: 'campaign-reviews', source: campaignReviews },
  { type: 'computation', name: 'campaign-pace', source: campaignPace },
  { type: 'workflow', name: 'greet', source: greet },
];

const decodeOverview = Schema.decodeUnknownSync(Schema.Struct({ overview: Schema.String }));

let server: ReasoningServer;

let createdStatuses: readonly number[];

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: JSON.stringify([admin.entry, reader.entry]) });
  await server.call('POST', '/v1/orgs/acme/playbooks', { key: admin.key, body: { playbook: 'alpha', name: 'Alpha' } });
  const created = await Promise.all(
    saved.map(({ type, name, source }) =>
      server.call('POST', `${alpha}/definitions/${type}`, { key: admin.key, body: { name, source } }),
    ),
  );
  createdStatuses = created.map(({ status }) => status);
});

afterEach(async () => {
  await server.stop();
});

async function overviewOverHttp({ type, name }: Saved): Promise<string> {
  const { body } = await server.call('GET', `${alpha}/definitions/${type}/${name}`, { key: reader.key });
  return decodeOverview(body).overview;
}

const predictionAndWorkflow: ReadonlySet<string> = new Set(['prediction', 'workflow']);

function headingsOf(overview: string): readonly string[] {
  return overview
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice('## '.length));
}

describe('the overview of every type of definition', { timeout: 60_000 }, () => {
  it('is answered over HTTP to a key that may read the playbook, opening with its name, and is not listed', async () => {
    const overviews = await Promise.all(saved.map((definition) => overviewOverHttp(definition)));
    const listed = await server.call('GET', `${alpha}/definitions/reasoning`, { key: reader.key });

    expect(createdStatuses).toEqual(saved.map(() => 201));
    expect(overviews.map((overview) => overview.slice(0, overview.indexOf('\n\n')))).toEqual(
      saved.map(({ name }) => `# ${name}`),
    );
    expect(overviews.every((overview) => overview.split('\n\n').length > 2)).toBe(true);
    expect(listed).toMatchObject({ status: 200, body: { definitions: [{ name: 'review-brief' }] } });
    expect(listed.body).not.toHaveProperty('definitions.0.overview');
  });

  it('shows a prediction function and a workflow in sections of their own types', async () => {
    const overviews = await Promise.all(
      saved.filter(({ type }) => predictionAndWorkflow.has(type)).map((definition) => overviewOverHttp(definition)),
    );

    expect(overviews.map((overview) => headingsOf(overview))).toEqual([
      ['What it predicts', 'What it learns from', 'Who trains it', 'How a version goes live', 'Rules'],
      ['What starts it', 'What it needs', 'What it produces', 'What it does', 'What it calls'],
    ]);
  });

  it('is answered over MCP to the same key, as over HTTP', async () => {
    const overHttp = await Promise.all(saved.map((definition) => overviewOverHttp(definition)));
    const overMcp = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: { authorization: `Bearer ${reader.key}` } },
      (session) =>
        Promise.all(
          saved.map(
            async ({ type, name }) =>
              decodeOverview((await session.callTool('get_definition', { type, name })).structuredContent).overview,
          ),
        ),
    );

    expect(overMcp).toEqual(overHttp);
  });
});
