import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { longToolName, reportingAccess, serveFakeMcp, type FakeMcpOptions } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

interface ToolLists {
  readonly allowed?: readonly string[];
  readonly testable?: readonly string[];
}

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listed(lists: ToolLists) {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...lists };
  const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return Effect.runPromise(access.listServers({ org: 'acme', brain: 'alpha' }));
}

const nothingTaken = { type: 'object', properties: {}, required: [] };

const queried = {
  type: 'object',
  properties: { query: { type: 'string', description: 'What to look for' } },
  required: ['query'],
};

describe('the hints a listing shows of each tool', () => {
  it('are those its server gives, booleans only, and none where it gives none, a title left out', async () => {
    const listing = await listed({ allowed: ['search', 'echo', 'environment', 'graph.query.v2'] });

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'http',
        tools: [
          {
            name: 'search',
            description: 'Finds the rows of the graph that match a query.',
            input_schema: queried,
            annotations: { readOnlyHint: true, openWorldHint: true },
            testable: true,
          },
          { name: 'echo', description: 'Answers with its arguments.', input_schema: nothingTaken, testable: false },
          {
            name: 'environment',
            description: 'Answers with the names of the environment variables of the server.',
            input_schema: nothingTaken,
            testable: false,
          },
          {
            name: 'graph.query.v2',
            description: 'A tool whose name holds dots.',
            input_schema: queried,
            annotations: { readOnlyHint: true, destructiveHint: true },
            testable: true,
          },
        ],
      },
    ]);
  });
});

describe('the tools a listing says can be tested', () => {
  it('are those their server marks read-only and those its entry marks testable, and no other', async () => {
    const listing = await listed({ testable: ['echo'] });
    const testedAsListed: unknown = expect.arrayContaining([
      expect.objectContaining({ name: 'search', testable: true }),
      expect.objectContaining({ name: 'list_channels', testable: true }),
      expect.objectContaining({ name: 'graph.query.v2', testable: true }),
      expect.objectContaining({ name: 'echo', testable: true }),
      expect.objectContaining({ name: 'environment', testable: false }),
      expect.objectContaining({ name: 'exit', annotations: { destructiveHint: true }, testable: false }),
      expect.objectContaining({ name: longToolName, annotations: { destructiveHint: false }, testable: false }),
    ]);

    expect(listing).toMatchObject([{ tools: testedAsListed }]);
  });

  it('are only those its entry allows, a read-only tool outside allowed not among them', async () => {
    const listing = await listed({ allowed: ['echo', 'environment'], testable: ['echo'] });

    expect(listing).toMatchObject([
      {
        tools: [
          { name: 'echo', testable: true },
          { name: 'environment', testable: false },
        ],
      },
    ]);
  });
});

async function notedAfterListing(listings: number, served: FakeMcpOptions, lists: ToolLists = {}) {
  const fake = await serveFakeMcp({ bearer: apiKey, ...served });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...lists };
  const wiki = { ...graph, brains: ['beta'] };
  const reporting = reportingAccess({ graph, wiki }, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(reporting.access.close);
  const before = reporting.untestable();
  const listing = reporting.access.listServers({ org: 'acme', brain: 'alpha' });
  await Effect.runPromise(Effect.all(Array.from({ length: listings }, () => listing)));
  return { before, after: reporting.untestable() };
}

describe('a tool server on which nothing can be tested', () => {
  it('is noted once, where its tools are first listed, when it marks no tool read-only and its entry marks none testable', async () => {
    expect(await notedAfterListing(2, { annotated: false })).toEqual({ before: [], after: ['graph'] });
  });

  it('is not noted when it marks a tool read-only, or when its entry marks one of its tools testable', async () => {
    expect(await notedAfterListing(1, {})).toEqual({ before: [], after: [] });
    expect(await notedAfterListing(1, { annotated: false }, { testable: ['echo'] })).toEqual({
      before: [],
      after: [],
    });
  });
});
