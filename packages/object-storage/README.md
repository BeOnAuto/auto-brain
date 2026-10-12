# @beonauto/object-storage

The content port of [`@beonauto/operations`](../operations/README.md#recorded-content), `RecordedContent`, kept on an object store that speaks the S3 API, the second adapter of the port beside the ledger's own database. The server chooses it when `CONTENT_STORE_URL` is set and hands it to the ledger as its content store; the ledger keeps every other record in its database as before, and the database adapter stays the default. This package holds the adapter alone, so the ledger depends on no part of the AWS SDK.

## Entry

`@beonauto/object-storage` (`src/index.ts`) exports three functions:

- `contentLocationOf(url)` reads `CONTENT_STORE_URL`, an `s3://bucket/prefix` URL, into `{ bucket, prefix }`, or nothing for a URL that is not one: the scheme is `s3:`, the bucket follows the S3 naming rule, 3 to 63 lowercase letters, digits, dots and hyphens, and the URL names no user, password, port, query or fragment. The prefix is the path without its leading, trailing and doubled slashes, and may be empty.
- `storageClientOf({ endpoint, region, proxy }, credentials)` makes the `S3Client`. A custom endpoint is addressed by path, `http://host:9000/bucket/key`, as S3-compatible servers expect; without one the client addresses the S3 endpoint of its region by host. Without a region the SDK finds one by its own chain. With the environment proxy on, `NODE_USE_ENV_PROXY=1`, the client's requests go through the proxy as the credential chain's do, through `awsClientSettingsOf` of [`@beonauto/outbound/aws`](../outbound/README.md#aws-clients). The client computes a request checksum and checks a response checksum only where the S3 API requires one, `WHEN_REQUIRED`, since the SDK's default of a checksum on every request is one many S3-compatible servers refuse; the content's own SHA-256 proves every byte read back.
- `objectContentOn(client, location)` answers `{ content, sweepContent }`: `content`, the port, and `sweepContent(before)`, the sweep of uploads below. `client` is a function that answers the client, so that nothing passes the client itself, whose fields are not read-only, as a parameter.

The server composes them in `packages/server/src/composition/content-store.ts`: the location and the endpoint from the content store settings, the region from `AWS_REGION`, and the credentials from `awsCredentialChain` of `@beonauto/outbound/aws`, the default credential chain of the AWS SDK that the Bedrock provider of the reasoning capability uses too.

## The keys

| Key                                                   | What it holds                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `<prefix>/brain/<org>/<brain>/<sha256>`               | a content kept under a brain: its bytes, its media type as the object's content type and its size as its own |
| `<prefix>/staging/brain/<org>/<brain>/<run>/<sha256>` | a content staged under a run, the run's id URI-encoded so that it is one segment of the key                  |
| `<prefix>/staging/brain/<org>/<brain>/<run>/.ended`   | the empty marker of a run whose staging ended                                                                |
| `<prefix>/uploads/<upload id>`                        | the bytes of a put on their way, under the put's own UUIDv7                                                  |

`brain/<org>/<brain>/` is the brain key the ledger's content tables keep a brain under, `streamPrefixOfBrain` of `@beonauto/operations`, so the two adapters name a brain alike. A key is the prefix and the rest joined by `/`, or the rest alone when the prefix is empty. The presence of an object is the head the database adapter writes last: there is no other record of a content.

## A put

`content.put(brain, { stream, mediaType, expected? })` reads the stream through `takenInChunks` of `@beonauto/operations`, in chunks of 1 MiB, digesting and counting the bytes as they pass, and `requireExpected` refuses a digest or a size other than the one `expected` names, as a stream that fails is refused, each a `ContentRefused`; the database adapter takes the same intake and the same refusals.

- A put whose expected digest the brain holds reads its stream through the digest, writes nothing, and answers the object it found.
- A content of one chunk is still in hand at the end of its stream. When the brain holds its digest, the put writes nothing and answers the object it found, as the database adapter does; otherwise it writes the chunk under its digest with `If-None-Match: *`, so a second put of the digest that wrote first stands, and the put answers that one's media type and size.
- A larger content is uploaded while it is read, under `<prefix>/uploads/<upload id>`, through `Upload` of `@aws-sdk/lib-storage`: as one `PutObject` when it fits a part and as a multipart upload in parts of 5 MiB, the least the S3 API takes, two at once, otherwise. The upload finishes, the expected digest and size are checked, and the put looks for the object of the digest: when one is held it deletes its upload and answers the one held, so the first media type stands and nothing is written over it; otherwise it copies the upload under the digest with `CopyObject` and `If-None-Match: *` and deletes the upload. A copy refused because another put of the digest copied first answers that one. A store that ignores the condition on a copy, as MinIO and versitygw do, copies the same bytes over the first, so of two puts of one digest made at the same moment with two media types the later one's stands there; a put of a digest held is never copied.
- A put refused, or failed by its stream or by its store, deletes its upload; `Upload` aborts a multipart upload it began. A failure of the store fails the put as a defect, as the database adapter fails on its database.

## A read

`content.get(brain, sha256)` asks for the object with `GetObject` and answers `{ stream, bytes, mediaType }`, or nothing when the object does not exist; any other answer of the store fails the read as a defect. The stream is the object's body read through `verifiedStream` of `@beonauto/operations`, the verification the database adapter reads its chunks through: it digests every piece, hands over the piece that reaches the object's size only once the size and the digest are checked, and fails the stream as a defect with `notTheBytesOfItsDigest` otherwise, so no reader takes every byte of an object that is not its digest's.

## Staging

`content.stage(brain, run, content)` keeps a content under the run as a put keeps it under the brain, and `content.staged(brain, run, sha256)` reads it as a get reads. `content.unstage(brain, run)` writes the run's marker first and then lists every object under the run's prefix and deletes them, a thousand to a request. A stage looks at the marker before it reads its stream and is refused with `StagingEnded`, leaving the stream unread, when the marker is there; it looks again once its object is written, and when the marker is there then, it deletes the object and is refused the same way. Since the unstage writes the marker before it lists, and an S3 store answers a read made after a write with what was written, either the stage sees the marker or the unstage's listing sees the object, so a stage that races an unstage keeps nothing, as the database adapter's `unstaged_runs` record ensures there. The markers stay, one empty object for each run whose staging ended. A read of a staged content that began before its run was unstaged reads the whole object, since the store answers a `GetObject` it began; the database adapter, which reads a chunk at a time, fails such a read part way.

## The sweep of uploads

An upload can outlive its put: a process that stops between the upload and its delete leaves it, and a multipart upload begun before the stop stays open. `sweepContent(before)` deletes every object under `<prefix>/uploads/` whose UUIDv7 time is before the time it is given, reading the listing in key order, which is the order of the time a UUIDv7 carries in its first 48 bits, and stopping at the first upload begun after it; it then aborts every open multipart upload under the same prefix that began before that time, where the store lists them by prefix. The ledger runs it on the schedule of its own sweep, at the open and every hour, with the time an hour before, and waits for a sweep under way before it closes, as the [ledger README](../ledger/README.md#recorded-content) says. MinIO lists no multipart upload by prefix, so there the sweep leaves open multipart uploads to the store's own expiry or to a lifecycle rule.

## What the bucket needs

The bucket exists before the server starts; the server creates none. The server's credentials may read, write, copy and delete objects under the prefix, list the bucket, and list and abort multipart uploads: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:ListBucketMultipartUploads` and `s3:AbortMultipartUpload` in the S3 API's terms. Versioning is not required, and with versioning on every delete leaves a noncurrent version behind, so such a bucket needs a lifecycle rule that expires noncurrent versions. A lifecycle rule is otherwise optional: the sweep removes what puts left behind, and a rule that aborts incomplete multipart uploads after a day changes nothing the sweep does. Several servers may share a bucket and a prefix, as they share the ledger's database.

## Measurement

`measure/object-content.ts` runs the measurement of the ledger's database adapter, `measuredContent` of [`@beonauto/ledger/content-measurement`](../ledger/README.md#recorded-content), on this adapter: the answers of 100 bytes to 20 MB of JSON put three times, the second time as they are and the third with their digest expected, and read back and parsed, then 64 MiB of bytes as a stream the same three ways, read back with their digest checked, and the most the process held while it put and got the 64 MiB once more for another brain. It creates the bucket of the URL it is given when there is none and deletes what it kept:

```bash
CONTENT_MEASURE_OBJECT_STORE_URL=http://access:secret@127.0.0.1:9000/content-measure pnpm --filter @beonauto/object-storage measure:content
```

| Store          | Content          | Kept     | Kept again | Kept again, its digest given | Read back and parsed | Joined back exactly |
| -------------- | ---------------- | -------- | ---------- | ---------------------------- | -------------------- | ------------------- |
| Object storage | 100 B            | 5.7 ms   | 1.4 ms     | 1.1 ms                       | 1.6 ms               | yes                 |
| Object storage | 64 KiB           | 2.3 ms   | 0.98 ms    | 0.97 ms                      | 1.0 ms               | yes                 |
| Object storage | 1 MB             | 5.0 ms   | 1.3 ms     | 1.2 ms                       | 3.3 ms               | yes                 |
| Object storage | 5 MB             | 33.0 ms  | 16.7 ms    | 2.6 ms                       | 11.3 ms              | yes                 |
| Object storage | 20 MB            | 85.2 ms  | 49.3 ms    | 8.8 ms                       | 44.1 ms              | yes                 |
| Object storage | 64 MiB, streamed | 267.1 ms | 137.7 ms   | 25.9 ms                      | 69.6 ms              | yes                 |

Kept again, a content of one chunk costs one `HeadObject`; a larger one is uploaded again, found held and its upload deleted, about half what the first put cost, which also copied; given its digest, a put of a content the brain holds reads its stream through the digest and writes nothing. While the 64 MiB were put and got, the process held at most 16.6 MiB and 11.9 MiB more heap and array buffers than before, and its resident set rose by at most 1.1 MiB and 0.1 MiB, the median of three runs, so neither holds the object. The put holds more than the database adapter's, 2.9 to 3.9 MiB on SQLite, because `Upload` gathers each part of 5 MiB whole before it sends it and keeps the part it sends while it gathers the next; the read holds less than a fifth of the object.

Measured on 2026-10-12 on an Apple M4 Max with 16 cores, with Node 26.10.0, against MinIO RELEASE.2025-10-15T17-29-55Z serving one drive on the loopback, each figure the median of three runs, at a load average of 3.7 to 4.4. The ledger's own figures for SQLite and PostgreSQL are in its [README](../ledger/README.md#recorded-content).

## Testing

The unit tests run the adapter against a fake bucket, `src/testing/fake-bucket.ts`: an `S3Client` made by `storageClientOf` whose middleware answers every command the adapter sends from objects and multipart uploads it keeps in memory, with pages of the size it is given, a conditional copy honoured or ignored, and requests it can be told to answer otherwise once, so that every path of the adapter, the failures of the store among them, runs without a server. `src/testing/object-content-behaviour.ts` holds what is particular to objects, the keys, a read of an object filed under another digest and the sweep, and `src/testing/object-store-entry.ts` gives each test a prefix of its own and empties it afterwards.

The behaviour suite of the port, `recordedContentBehaviour` of `@beonauto/operations/testing`, the one the ledger runs on SQLite and PostgreSQL, runs here on the fake bucket, honouring a conditional copy and ignoring it, and on a real S3-compatible server when `CONTENT_TEST_OBJECT_STORE_URL` names one with its credentials and its bucket, which the tests create when it does not exist; without it the suite is skipped, and its title says how to run it:

```bash
CONTENT_TEST_OBJECT_STORE_URL=http://access:secret@127.0.0.1:9000/content-test pnpm --filter @beonauto/object-storage test
```

CI runs it against RustFS, an S3-compatible server whose image runs from its environment alone, as a service beside PostgreSQL; locally it passes against MinIO, versitygw and RustFS alike. The server's own test of a reasoning run that keeps 25 answers of 1 MB, `packages/server/src/reasoning/large-answers-on-stores.test.ts`, runs on the same server too, with its content on object storage.

## Source

`src/location` holds the URL and the keys, `src/client` the client, `src/content` the adapter, and `src/testing` the fake bucket and the suites.
