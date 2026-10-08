import { fileURLToPath } from 'node:url';

import { serveFakeMcp, type FakeMcpOptions } from '@beonauto/mcp/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const graphKey = 'graph-api-key-4f1d9a7c2b';

const note = '"message":"Nothing on MCP server graph can be tested';

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

async function notesAfterTwoListings(served: FakeMcpOptions): Promise<number> {
  const graph = await serveFakeMcp({ bearer: graphKey, ...served });
  const child = spawnServer(mainModule, {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: graphKey,
    MCP_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'local' },
    }),
  });
  const tools = `http://127.0.0.1:${await child.port}/v1/orgs/local/tool-servers`;
  const before = child.output().stderr;
  await fetch(tools).then((answer) => answer.text());
  await fetch(tools).then((answer) => answer.text());
  child.signal('SIGTERM');
  await child.exited;
  await graph.close();
  expect(before).not.toContain(note);
  return child.output().stderr.split(note).length - 1;
}

describe('the note on a tool server on which nothing can be tested', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('is logged once, where its tools are first listed, when it marks no tool read-only', async () => {
    expect(await notesAfterTwoListings({ annotated: false })).toBe(1);
  });

  it('is not logged when it marks a tool read-only', async () => {
    expect(await notesAfterTwoListings({})).toBe(0);
  });
});
