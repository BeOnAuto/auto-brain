# Keep content on object storage

By default, the content a playbook keeps is stored in the ledger's database. Set `CONTENT_STORE_URL` to an `s3://bucket/prefix` URL and the server keeps that content in an S3 bucket instead, one object for each piece of content under its playbook and its SHA-256. Every other record stays in the ledger.

Content is what grows large: a tool's arguments and answers, a prediction function's uploaded datasets, the rows and the brief of each build, and the model file of each version. A build's candidates are staged under `<prefix>/staging/` and deleted when the build ends. Moving content out keeps the database small and its backups fast.

The server speaks the S3 API, so the bucket may be on Amazon S3 or on any S3-compatible server.

## Settings

| Variable                                    | Purpose                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTENT_STORE_URL`                         | The bucket and the prefix, `s3://bucket/prefix`; the bucket is 3 to 63 lowercase letters, digits, dots and hyphens, and the prefix may be empty                                                                                                                                                           |
| `AWS_ENDPOINT_URL_S3` or `AWS_ENDPOINT_URL` | The endpoint of an S3-compatible server, such as `http://storage.internal:9000`, addressed by path; the first is read before the second, which is also the Bedrock provider's endpoint unless `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` is set, so with Bedrock configured, name the storage server in the first |
| `AWS_REGION`                                | The region requests are signed for, which the AWS SDK otherwise reads from a profile; without either the server stops at start. S3-compatible servers commonly take `us-east-1`                                                                                                                           |

The credentials come from the AWS default credential chain, as the Bedrock provider's do: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the container's environment, a profile, a web identity, or the role of the container or the instance.

## Amazon S3

Give the role the container runs as access to the bucket, then set the URL and the region:

```bash
echo 'CONTENT_STORE_URL=s3://acme-auto-runtime/content' >> auto-runtime.env
echo 'AWS_REGION=eu-west-1' >> auto-runtime.env
```

## An S3-compatible server

Name its endpoint and give it an access key:

```bash
echo 'CONTENT_STORE_URL=s3://auto-runtime/content' >> auto-runtime.env
echo 'AWS_ENDPOINT_URL_S3=http://storage.internal:9000' >> auto-runtime.env
echo 'AWS_REGION=us-east-1' >> auto-runtime.env
echo 'AWS_ACCESS_KEY_ID=<access key>' >> auto-runtime.env
echo 'AWS_SECRET_ACCESS_KEY=<secret key>' >> auto-runtime.env
```

## The bucket

The bucket must exist; the server creates none, and checks it at start. A bucket it cannot reach, for a refusal, a missing bucket, a missing region or an endpoint that does not answer, stops it at start, naming `CONTENT_STORE_URL`, the bucket, the endpoint's host and the store's answer, and never a credential. Once it reaches the bucket, it logs that content is kept on object storage, naming the bucket, the prefix and the endpoint's host.

Its credentials need to read, write, copy and delete objects under the prefix, list the bucket, and list and abort multipart uploads. In the S3 API's terms, that is `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on the objects under the prefix, and `s3:ListBucket`, which the check at start needs too, and `s3:ListBucketMultipartUploads` on the bucket. Several servers may share a bucket and a prefix, as they share the ledger's database.

Versioning is not required. On a bucket with versioning on, every delete keeps a noncurrent version, so give such a bucket a lifecycle rule that expires them. A lifecycle rule is otherwise optional: every hour the server deletes what uploads that never finished left under `<prefix>/uploads/`.

Back up the bucket alongside the database: the ledger's records name their content by its digest, and that content is only in the bucket.
