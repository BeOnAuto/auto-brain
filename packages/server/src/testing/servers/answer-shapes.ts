import { openRequests } from '@beonauto/interaction';
import { partnerSecret } from '@beonauto/interaction/testing';
import { Ledger, type RunProjection } from '@beonauto/operations';
import { serveFakeReceiver } from '@beonauto/outbound/testing';
import { ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { interactionServerOn, servingInteractions, type InteractionServer } from './interaction-server.ts';
import { alpha } from './reasoning-server.ts';
import { until } from './workflow-calls.ts';
import { workflowTestTimeoutMs } from './workflow-server.ts';

export interface ProjectionStore {
  readonly environment: Readonly<Record<string, string>>;
  readonly ledgerKeeping: (projection: RunProjection) => Layer.Layer<Ledger>;
  readonly tablesOf: (projection: string) => Promise<readonly string[]>;
  readonly dropTable: (table: string) => Promise<void>;
}

export interface ProjectionStoreChoice {
  readonly store: string;
  readonly skipped: boolean;
  readonly aStore: () => Promise<ProjectionStore>;
}

const versionOne: RunProjection = {
  ...openRequests,
  version: 1,
  columns: openRequests.columns.filter(({ name }) => name !== 'answer_schema'),
  rowAfter: (row, event, message) =>
    openRequests.rowAfter(row === undefined ? undefined : { ...row, answer_schema: null }, event, message),
};

const approvalSchema = {
  type: 'object',
  required: ['choice'],
  properties: { choice: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', maxLength: 2000 } },
};

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    interactions: Schema.Array(
      Schema.Struct({
        execution_id: Schema.String,
        standing: Schema.String,
        answer_schema: Schema.NullOr(Schema.JsonObject),
      }),
    ),
  }),
);

async function answerShapesIn(server: InteractionServer): Promise<Readonly<Record<string, unknown>>> {
  const { interactions } = await until(
    async () => decodeListed((await server.call('GET', `${alpha}/interactions`)).body),
    (listed) =>
      listed.interactions.length === 2 && listed.interactions.every(({ standing }) => standing === 'retrying'),
  );
  return Object.fromEntries(interactions.map(({ execution_id: id, answer_schema: schema }) => [id, schema]));
}

async function failingPartner(): Promise<Readonly<Record<string, string>>> {
  const partner = await serveFakeReceiver();
  onTestFinished(partner.close);
  partner.answerEveryWith({ status: 503 });
  return {
    CHANNELS: JSON.stringify({
      partner: { type: 'webhook', url: partner.url, secret: '${PARTNER_WEBHOOK_SECRET}', to: '^[a-z]+$', org: 'acme' },
    }),
    PARTNER_WEBHOOK_SECRET: partnerSecret,
  };
}

async function versionOneLeftIn(store: ProjectionStore): Promise<readonly string[]> {
  await store.dropTable('open_requests_2');
  const runtime = ManagedRuntime.make(store.ledgerKeeping(versionOne));
  await runtime.runPromise(Ledger);
  await runtime.dispose();
  return store.tablesOf('open_requests');
}

export function answerShapesOn(stores: readonly ProjectionStoreChoice[]): void {
  describe.each(stores)('the answer shape of an open request, on $store', ({ skipped, aStore }) => {
    it.skipIf(skipped)(
      'is the schema a question recorded and null for a notification, as each append keeps it and once the table of version 1 is rebuilt',
      { timeout: workflowTestTimeoutMs },
      async () => {
        const store = await aStore();
        const environment = { ...store.environment, ...(await failingPartner()) };
        const first = await servingInteractions('partner', environment);
        const question = await first.ask('approve-brief');
        const notification = await first.ask('brief-out');
        const kept = await answerShapesIn(first);
        await first.stop();
        const leftByVersionOne = await versionOneLeftIn(store);

        const second = await interactionServerOn(environment);
        const rebuilt = await answerShapesIn(second);

        expect(leftByVersionOne).toEqual(['open_requests_1']);
        expect([kept, rebuilt]).toEqual([
          { [question]: approvalSchema, [notification]: null },
          { [question]: approvalSchema, [notification]: null },
        ]);
        expect(await store.tablesOf('open_requests')).toEqual(['open_requests_2']);
      },
    );
  });
}
