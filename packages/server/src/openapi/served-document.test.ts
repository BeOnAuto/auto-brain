import { Buffer } from 'node:buffer';

import { oldWordsIn, openApiErrorsIn, operationsIn, unresolvedSchemasIn, withMcpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let text: string;
let document: unknown;

beforeAll(async () => {
  server = await servingReasoning([]);
  text = await (await fetch(`${server.origin}/v1/openapi.json`)).text();
  document = JSON.parse(text);
});

afterAll(async () => {
  await server.stop();
});

const TagsSchema = Schema.Struct({ tags: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ResourcesSchema = Schema.Struct({ resources: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ContentsSchema = Schema.Struct({ contents: Schema.Array(Schema.Struct({ text: Schema.String })) });

function resourcesOverMcp(): Promise<readonly (readonly [string, string])[]> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
    const { resources } = Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources());
    return Promise.all(
      resources.map(async ({ name }) => {
        const { contents } = Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(`guide://${name}`));
        return [name, contents.map((content) => content.text).join('')] as const;
      }),
    );
  });
}

describe('the OpenAPI document of the server', () => {
  it('is one the published schema of OpenAPI 3.1 accepts, every schema in it resolving its references by its $id', () => {
    expect(openApiErrorsIn(document)).toEqual([]);
    expect(unresolvedSchemasIn(document)).toEqual([]);
  });

  it('describes the 31 operations of the catalog and the guides, under the tags of their resources', () => {
    expect(operationsIn(document)).toHaveLength(32);
    expect(Schema.decodeUnknownSync(TagsSchema)(document).tags.map(({ name }) => name)).toEqual([
      'playbooks',
      'models',
      'tool-servers',
      'definitions',
      'runs',
      'analytics',
      'events',
      'interactions',
      'prediction',
      'guides',
    ]);
  });

  it('takes 163,071 bytes and those of the version of the release, 163,076 at 0.8.0', () => {
    expect(Buffer.byteLength(text) - Buffer.byteLength(release.version)).toBe(163_071);
  });

  it('names the OpenID Connect metadata of the Auto identity service when IDENTITY_ISSUER is not set', () => {
    expect(document).toMatchObject({
      components: {
        securitySchemes: {
          openIdConnect: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://auth.on.auto/.well-known/openid-configuration',
          },
        },
      },
    });
  });

  it('says none of the old words the vocabulary of the repository refuses', () => {
    expect(oldWordsIn(text)).toEqual([]);
  });
});

describe('the guides over HTTP', () => {
  it('are each guide the MCP resources hold, byte for byte, without a key', async () => {
    const resources = await resourcesOverMcp();
    const overHttp = await Promise.all(
      resources.map(
        async ([name]) => [name, await (await fetch(`${server.origin}/v1/guides/${name}`)).text()] as const,
      ),
    );

    expect(resources).toHaveLength(11);
    expect(overHttp).toEqual(resources);
  });
});
