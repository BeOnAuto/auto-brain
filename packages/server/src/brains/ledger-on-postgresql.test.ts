import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { answers, textResult } from '@beonauto/inference/testing';
import { describe, expect, it } from 'vitest';

import { servingInference } from '../testing/inference-server.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const onPostgreSQL = { LOCAL_MODE: 'true', LEDGER_FILE: '', DATABASE_URL: server };

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

describe.skipIf(skipped)(
  `A server that keeps its ledger in PostgreSQL${notice}`,
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('executes an inference spec of a brain it created, and reads the execution again after a restart', async () => {
      const brain = `/v1/orgs/run-${randomUUID()}/brains/alpha`;
      const first = await servingInference([answers(textResult('Profits rose.'))], onPostgreSQL);
      const created = await first.call('POST', brain.replace(/\/alpha$/u, ''), {
        body: { brain: 'alpha', name: 'Alpha' },
      });
      const spec = await first.call('POST', `${brain}/specs/inference`, { body: { name: 'summary', source: summary } });
      const executed = await first.call('POST', `${brain}/specs/inference/summary/execute`, {
        body: { input: { text: 'the quarter' }, execution_id: executionId },
      });
      const execution = `${brain}/executions/${executionId}`;
      const before = await first.call('GET', execution);
      await first.stop();

      const second = await servingInference([], onPostgreSQL);
      const after = await second.call('GET', execution);
      const brainAfter = await second.call('GET', brain);
      await second.stop();

      expect([created.status, spec.status, executed.status, before.status]).toEqual([201, 201, 200, 200]);
      expect(before.body).toMatchObject({ status: 'succeeded', output: 'Profits rose.', name: 'summary' });
      expect(after).toMatchObject({ status: 200, body: before.body });
      expect(brainAfter).toMatchObject({ status: 200, body: { id: 'alpha', name: 'Alpha', status: 'active' } });
    });

    it('says at start-up that the ledger is in PostgreSQL, with its database and host and never its URL', async () => {
      const { host, pathname, password } = new URL(server);
      const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', ...onPostgreSQL });
      await child.port;
      child.signal('SIGTERM');

      expect(await child.exited).toBe(0);
      expect(child.output().stderr).toContain(
        `"message":"The ledger is kept in PostgreSQL, in the database ${pathname.slice(1)} on ${host}"`,
      );
      expect(child.output().stderr).not.toContain(server);
      expect(child.output().stderr).not.toContain(`:${password}@`);
    });
  },
);
