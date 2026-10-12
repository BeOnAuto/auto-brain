import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { contentTableHead, measuredContent } from '@beonauto/ledger/content-measurement';

import { storageClientOf } from '../src/client/storage-client.ts';
import { keysUnder, removed } from '../src/content/bucket-requests.ts';
import { objectContentOn } from '../src/content/object-content.ts';

const server = new URL(
  process.env['CONTENT_MEASURE_OBJECT_STORE_URL'] ?? 'http://access:secret@127.0.0.1:9000/measure',
);

const client = storageClientOf(
  { endpoint: server.origin, region: 'us-east-1', proxy: { enabled: false, environment: {} } },
  { accessKeyId: decodeURIComponent(server.username), secretAccessKey: decodeURIComponent(server.password) },
);

const bucket = { client: () => client, name: server.pathname.slice(1) };

const location = { bucket: bucket.name, prefix: `content-measure/${String(Date.now())}` };

const bucketHeld = () => client.send(new HeadBucketCommand({ Bucket: bucket.name }));
await bucketHeld().catch(() => client.send(new CreateBucketCommand({ Bucket: bucket.name })).catch(bucketHeld));
contentTableHead();
const held = await measuredContent('Object storage', objectContentOn(bucket.client, location).content);
process.stdout.write(`\n${held}\n`);
const kept: string[] = [];
for await (const key of keysUnder(bucket, location.prefix)) {
  kept.push(key);
}
await removed(bucket, kept);
