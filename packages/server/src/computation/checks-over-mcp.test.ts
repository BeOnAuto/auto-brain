import { internalTermsIn, plainTextIn, problemIn, withMcpSession, type McpSession } from '@beonauto/api/testing';
import { campaignPace } from '@beonauto/computation/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../composition/served-computation.ts';
import { checkRefusals, documentOf } from '../testing/servers/check-refusals.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const checkTestTimeoutMs = 30_000;

const misspelt = [
  '---',
  'language: typescript',
  'input:',
  '  schema: {type: object, required: [period], properties: {period: {type: integer}}}',
  '---',
  'export default function (input: Input): Output {',
  '  return input.perod;',
  '}',
].join('\n');

type ToolResult = Awaited<ReturnType<McpSession['callTool']>>;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function stallingChecks(): { readonly stall: () => void; readonly poolOf: ProgramPoolOf } {
  let stalled = false;
  return {
    stall: () => {
      stalled = true;
    },
    poolOf: (settings) => {
      const pool = workerPool(settings);
      return {
        ...pool,
        check: (request, signal) =>
          stalled
            ? Promise.resolve({ ran: 'stopped', because: 'deadline', milliseconds: 2000 })
            : pool.check(request, signal),
      };
    },
  };
}

async function onAlpha<T>(programPoolOf: ProgramPoolOf, use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, { programPoolOf });
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

describe('a computation function checked when it is saved, over MCP', { timeout: checkTestTimeoutMs }, () => {
  it('answers a refused program with isError, its line and the compiler’s words, in plain words', async () => {
    const created = await onAlpha(workerPool, (session) =>
      session.callTool('create_definition', { type: 'computation', name: 'misspelt', source: misspelt }),
    );

    expect({ isError: created.isError, problem: problemIn(created) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail: "Line 7: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?",
          },
        ],
      },
    });
    expect(internalTermsIn(plainTextIn(created))).toEqual([]);
  });
});

describe('each refusal of the check at save, over MCP', { timeout: checkTestTimeoutMs }, () => {
  it('answers each refusal of the check with isError, its line and its words, as over HTTP', async () => {
    const created = await onAlpha(workerPool, (session) =>
      checkRefusals.reduce<Promise<readonly ToolResult[]>>(
        async (before, [, program], index) => [
          ...(await before),
          await session.callTool('create_definition', {
            type: 'computation',
            name: `refused-${index}`,
            source: documentOf(program),
          }),
        ],
        Promise.resolve([]),
      ),
    );

    expect(created.map((result) => ({ isError: result.isError, problem: problemIn(result) }))).toMatchObject(
      checkRefusals.map(([, , details]) => ({
        isError: true,
        problem: {
          status: 422,
          reason: 'invalid_input',
          errors: details.map((detail) => ({ pointer: '/source', detail })),
        },
      })),
    );
  });
});

describe('a check at save that does not answer in time, over MCP', { timeout: checkTestTimeoutMs }, () => {
  it('answers unavailable, on a create and an update, when the check does not answer in time', async () => {
    const { stall, poolOf } = stallingChecks();
    const saved = await onAlpha(poolOf, async (session) => {
      await session.callTool('create_definition', { type: 'computation', name: 'pace', source: campaignPace });
      stall();
      return [
        await session.callTool('create_definition', { type: 'computation', name: 'again', source: campaignPace }),
        await session.callTool('update_definition', { type: 'computation', name: 'pace', source: `${campaignPace}\n` }),
      ];
    });
    const unavailable = { isError: true, problem: { status: 503, reason: 'unavailable' } };

    expect(saved.map((result) => ({ isError: result.isError, problem: problemIn(result) }))).toMatchObject([
      unavailable,
      unavailable,
    ]);
  });
});
