import { Ledger, textToKeep } from '@beonauto/operations';
import { memoryRecordedContent } from '@beonauto/operations/testing';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { contentStoreOf } from './content-store.ts';
import { ledgerLayerOf } from './ledger-store.ts';

const alpha = { org: 'acme', brain: 'alpha' };

describe('the store the content of a brain is kept in', () => {
  it("is the ledger's own when no object store is set", () => {
    expect(contentStoreOf(readSettings({}))).toBeUndefined();
  });

  it('is an object store when CONTENT_STORE_URL is set, built without reaching it', () => {
    const store = contentStoreOf(
      readSettings({ CONTENT_STORE_URL: 's3://brain-content/production', AWS_ENDPOINT_URL: 'http://127.0.0.1:9' }),
    );

    expect(Object.keys({ ...store })).toEqual(['content', 'sweepContent']);
  });

  it('keeps what the ledger is given to keep, and reads it back, in the store it is composed with', async () => {
    const content = memoryRecordedContent();
    const runtime = ManagedRuntime.make(
      ledgerLayerOf({ store: 'sqlite', file: ':memory:' }, undefined, {
        content,
        sweepContent: () => Promise.resolve(),
      }),
    );
    onTestFinished(() => runtime.dispose());

    const kept = await runtime.runPromise(
      Effect.flatMap(Ledger, (ledger) => ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json'))),
    );

    expect(await Effect.runPromise(content.get(alpha, kept.sha256))).toMatchObject({ bytes: 13 });
  });
});
