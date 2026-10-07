import { randomUUID } from 'node:crypto';

import { recallDocument } from '@beonauto/recollection/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  brainWithReviews,
  inState,
  liveWith,
  recallTestTimeoutMs,
  recalled,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const secondStore = postgresql === '' ? 'SQLite, as LEDGER_TEST_POSTGRESQL_URL is not set' : 'PostgreSQL';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `recall_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href };
}

function secondEnvironment(): Promise<Readonly<Record<string, string>>> {
  return postgresql === '' ? Promise.resolve({}) : onADatabaseOfItsOwn();
}

const reviewRuns =
  'language: jq\nsource:\n  events:\n    - type: execution_succeeded\n      subject: inference/review-brief';

const byCampaign = recallDocument(
  [
    '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
    '| .[$campaign] += [$event.data.output.verdict? // "none" | tostring | .[0:20]]',
  ].join('\n'),
  `${reviewRuns}\nview:\n  initial: {}`,
);

const depths = recallDocument(
  'def depth: if . == 0 then 0 else (. - 1 | depth) + 1 end; . + [$event.data.output | tostring | length | depth]',
  `${reviewRuns}\nview:\n  initial: []`,
);

const outputs = [
  { campaign: 'spring', verdict: 'approve' },
  'a plain text answer',
  ['an', 'array'],
  { campaign: 7, verdict: 3 },
  { campaign: 'spring', verdict: 'x'.repeat(20_000) },
  { campaign: 'spring', verdict: 'reject' },
];

const decodeStanding = Schema.decodeUnknownSync(
  Schema.Struct({
    standing: Schema.Struct({
      folded: Schema.Number,
      stalled: Schema.Struct({ kind: Schema.String, line: Schema.NullOr(Schema.Number) }),
    }),
  }),
);

const decodeOutput = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Json }));

async function viewsOn(server: ReasoningServer) {
  await brainWithReviews(server, outputs.length);
  await server.call('POST', `${alpha}/specs/recollection`, { body: { name: 'campaigns', source: byCampaign } });
  await server.call('POST', `${alpha}/specs/recollection`, { body: { name: 'depths', source: depths } });
  await standingUntil(server, 'campaigns', liveWith(outputs.length));
  const stalled = decodeStanding(await standingUntil(server, 'depths', inState('stalled'))).standing;
  const campaigns = decodeOutput((await recalled(server, 'campaigns', {})).body).output;
  await server.stop();
  return { campaigns, depths: stalled };
}

describe(
  `a recall function on a server on SQLite and on one on ${secondStore}`,
  { timeout: recallTestTimeoutMs },
  () => {
    it('folds the same view from the same history, and stops at the same event where its fold recurses past its fixed depth', async () => {
      const second = await secondEnvironment();

      const onSQLite = await viewsOn(await servingRecall(verdicts(...outputs)));
      const onTheOther = await viewsOn(await servingRecall(verdicts(...outputs), second));

      expect(onTheOther).toEqual(onSQLite);
      expect(onSQLite).toMatchObject({
        campaigns: { spring: ['approve', 'xxxxxxxxxxxxxxxxxxxx', 'reject'], unknown: ['none', 'none', '3'] },
        depths: { folded: 4, stalled: { kind: 'depth', line: 10 } },
      });
    });
  },
);
