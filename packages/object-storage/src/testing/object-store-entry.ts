import type { S3Client } from '@aws-sdk/client-s3';
import type { ContentEntry } from '@beonauto/operations/testing';
import { onTestFinished } from 'vitest';

import { keysUnder, removed, uploadAbandoned, uploadsUnder, type Bucket } from '../content/bucket-requests.ts';
import { objectContentOn } from '../content/object-content.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';

export interface StoreClients {
  readonly writing: () => S3Client;
  readonly reading: () => S3Client;
  readonly bucket: string;
}

export interface ObjectStoreUnderTest {
  readonly bucket: Bucket;
  readonly location: ContentLocation;
  readonly reading: () => S3Client;
}

export interface ObjectStoreEntry {
  readonly aStore: () => Promise<ObjectStoreUnderTest>;
}

async function listed<A>(items: AsyncIterable<A>): Promise<readonly A[]> {
  const all: A[] = [];
  for await (const item of items) {
    all.push(item);
  }
  return all;
}

export function keysIn({ bucket }: ObjectStoreUnderTest, prefix: string): Promise<readonly string[]> {
  return listed(keysUnder(bucket, prefix));
}

export async function openUploadsIn({ bucket }: ObjectStoreUnderTest, prefix: string): Promise<readonly string[]> {
  return (await listed(uploadsUnder(bucket, prefix))).map(({ key }) => key);
}

async function emptied(store: ObjectStoreUnderTest): Promise<void> {
  const { bucket, location } = store;
  await Promise.all((await listed(uploadsUnder(bucket, location.prefix))).map((open) => uploadAbandoned(bucket, open)));
  await removed(bucket, await keysIn(store, location.prefix));
}

let stores = 0;

export function objectStoreEntry(clientsOf: () => Promise<StoreClients>): ObjectStoreEntry {
  return {
    aStore: async () => {
      const { writing, reading, bucket } = await clientsOf();
      stores += 1;
      const prefix = `content-test/${String(process.pid)}-${String(Date.now())}-${String(stores)}`;
      const store = { bucket: { client: writing, name: bucket }, location: { bucket, prefix }, reading };
      onTestFinished(() => emptied(store));
      return store;
    },
  };
}

export function contentEntryOf(entry: ObjectStoreEntry): ContentEntry {
  return {
    aStore: async () => {
      const store = await entry.aStore();
      const { uploads } = objectKeysOf(store.location);
      return {
        content: objectContentOn(store.bucket.client, store.location).content,
        elsewhere: objectContentOn(store.reading, store.location).content,
        unnamedLeft: async () => (await keysIn(store, uploads)).length + (await openUploadsIn(store, uploads)).length,
      };
    },
  };
}
