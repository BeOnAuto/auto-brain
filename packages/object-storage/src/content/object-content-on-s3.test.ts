import { CreateBucketCommand, HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { recordedContentBehaviour } from '@beonauto/operations/testing';
import { describe } from 'vitest';

import { storageClientOf } from '../client/storage-client.ts';
import { objectContentBehaviour } from '../testing/object-content-behaviour.ts';
import { contentEntryOf, objectStoreEntry } from '../testing/object-store-entry.ts';

const server = process.env['CONTENT_TEST_OBJECT_STORE_URL'] ?? '';

function clientOf(): S3Client {
  const url = new URL(server);
  return storageClientOf(
    { endpoint: url.origin, region: 'us-east-1', proxy: { enabled: false, environment: {} } },
    { accessKeyId: decodeURIComponent(url.username), secretAccessKey: decodeURIComponent(url.password) },
  );
}

const onTheServer = objectStoreEntry(async () => {
  const [writing, reading] = [clientOf(), clientOf()];
  const bucket = new URL(server).pathname.slice(1);
  const held = () => writing.send(new HeadBucketCommand({ Bucket: bucket }));
  await held().catch(() => writing.send(new CreateBucketCommand({ Bucket: bucket })).catch(held));
  return { writing: () => writing, reading: () => reading, bucket };
});

const skipped = server === '';

const notice = skipped
  ? ', skipped: set CONTENT_TEST_OBJECT_STORE_URL to the URL of an S3-compatible server with its credentials and a bucket, such as http://access:secret@127.0.0.1:9000/content-test, to run it'
  : '';

describe.skipIf(skipped)(`The content kept on an S3-compatible object store${notice}`, { timeout: 120_000 }, () => {
  recordedContentBehaviour(contentEntryOf(onTheServer));
  objectContentBehaviour(onTheServer);
});
