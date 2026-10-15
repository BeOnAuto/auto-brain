# Use PostgreSQL

Set `DATABASE_URL` to a PostgreSQL database and the server keeps its ledger there instead of in a SQLite file. Use PostgreSQL when you want your database service to take the backups, when the container should keep nothing of its own, or when several servers share one ledger.

The runtime is tested on PostgreSQL 18. The image needs nothing more for it: its PostgreSQL driver is pure JavaScript.

## Get a database

- **Beside the runtime, with Docker Compose.** [Run with PostgreSQL](docker.md#run-with-postgresql) has a Compose file that starts `postgres:18` with its data on a volume. It suits one machine.
- **A managed service.** Amazon RDS or Aurora PostgreSQL, Google Cloud SQL for PostgreSQL, Azure Database for PostgreSQL, or another provider's PostgreSQL 18. The provider takes backups, applies patches and can fail over; create a database and a user for the runtime as below.
- **A server you run.** Any PostgreSQL 18 server the containers can reach.

## Create the database and its user

The server creates its tables, and migrates them after an upgrade, in the database's `public` schema at every start, so its user needs `CREATE` on that schema every time, not only the first. A user that owns the database has it:

```sql
CREATE ROLE auto_runtime LOGIN PASSWORD '<a long random password>';
CREATE DATABASE auto_runtime OWNER auto_runtime;
```

Run these as an administrator, such as the master user of a managed database. A user that may only read and write the tables fails to start with `permission denied for schema public`.

## Connect

The URL holds the database's password, so it goes with the other secrets in the container's environment, such as `auto-runtime.env`, and never in the configuration file, which refuses a `database_url` key:

```bash
echo 'DATABASE_URL=postgresql://auto_runtime:<password>@db.example.com:5432/auto_runtime?sslmode=verify-full' >> auto-runtime.env
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env onauto/runtime:latest
```

A ledger in PostgreSQL needs `SECRETS_KEY`, the key the secrets kept in the database are sealed under, and the server stops at start without it, naming the setting; every server that shares the database takes the same key, as [Keep the secrets key](production.md#keep-the-secrets-key) describes. With `DATABASE_URL` the container needs no volume. At start the server logs that the ledger is kept in PostgreSQL, naming the database and its host and never the URL. A database it cannot reach stops it at start, naming the host and port. Setting `LEDGER_FILE` as well stops it at start too, since the ledger can be in only one place.

### TLS

For a database across a network, end the URL with `?sslmode=verify-full`: the connection is encrypted, and the database's certificate and host name are checked against the certificate authorities Node trusts. When your provider signs with its own authority, mount its certificate bundle in the container and name it with `NODE_EXTRA_CA_CERTS`:

```bash
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env \
  --volume "$PWD/provider-ca.pem:/etc/auto-runtime/provider-ca.pem:ro" \
  --env NODE_EXTRA_CA_CERTS=/etc/auto-runtime/provider-ca.pem \
  onauto/runtime:latest
```

Write `verify-full`. The driver treats `sslmode=require`, `prefer` and `verify-ca` as `verify-full` too, but prints a multi-line security warning the first time it connects. `sslmode=no-verify` encrypts without checking the certificate, which lets a machine in between read the connection; use it for nothing but a test.

## Without a password, on Amazon RDS

A database of Amazon RDS or Aurora PostgreSQL can authenticate its user with IAM instead of a password, so that no database password exists anywhere: the server signs a token for each connection it opens, from the identity the container runs as.

1. Turn IAM database authentication on for the instance or the cluster.
2. Grant the database user the `rds_iam` role, beside owning its database: `GRANT rds_iam TO auto_runtime;`. A user with that role signs in with a token.
3. Give the identity the container runs as, such as the role of its task or of its instance, `rds-db:connect` on that user: `arn:aws:rds-db:<region>:<account>:dbuser:<the instance's or cluster's resource id>/auto_runtime`.
4. Set `DATABASE_URL` without a password, and `DATABASE_CREDENTIALS=aws-iam`. Neither is a secret, so both may go in the container's environment.
5. Keep TLS on. The certificate authorities of Amazon RDS are not among those Node trusts, so mount their bundle, `global-bundle.pem`, in the container and name it with `NODE_EXTRA_CA_CERTS`.

```bash
echo 'DATABASE_URL=postgresql://auto_runtime@ledger.c9akciq32.eu-west-1.rds.amazonaws.com:5432/auto_runtime' >> auto-runtime.env
echo 'DATABASE_CREDENTIALS=aws-iam' >> auto-runtime.env
echo 'NODE_EXTRA_CA_CERTS=/etc/auto-runtime/rds-global-bundle.pem' >> auto-runtime.env
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env \
  --volume "$PWD/global-bundle.pem:/etc/auto-runtime/rds-global-bundle.pem:ro" onauto/runtime:latest
```

Each time the server opens a connection, it signs a new token for the host, the port and the user of `DATABASE_URL`, valid for 15 minutes, with the credentials of the AWS default credential chain, as the Bedrock provider and the object store take theirs, through the outbound proxy when `NODE_USE_ENV_PROXY=1` is set. It signs for the region the host name names, such as `eu-west-1` above, or, for a host name that names none, for `AWS_REGION`. The connection always uses TLS and checks the database's certificate and host name, as `sslmode=verify-full` does, with or without `sslmode` in the URL. The server logs at start the user and the region it signs for, never a token.

With `DATABASE_CREDENTIALS=aws-iam`, the server stops at start, naming the setting and never a value, when the URL holds a password, names no user, gives an `sslmode` other than `verify-full`, gives a TLS option such as `sslrootcert`, whose certificate authority goes in `NODE_EXTRA_CA_CERTS` instead, or gives any other option, or when neither the host name nor `AWS_REGION` names a region. A token it cannot sign, for credentials the chain cannot find, stops it at start with the chain's error. A token the database refuses, for a user without `rds_iam` or an identity without `rds-db:connect`, fails the connection with the database's error.

## Several servers on one database

Several servers may share the database, behind one load balancer. Every server answers requests; one of them runs the workflows, holding a claim on them that it renews every sweep, and the others stand by. If that server stops or dies, another takes the workflows over within about three seconds and a sweep. The database's clock judges the claim, so the servers' clocks need not agree. [Workflow operations](workflows.md#where-a-run-is-kept) describes the claim.

Servers of different versions do not share a database at the same time: stop every server of the old version before starting one of the new. A version that adds a table fills it from the ledger's history at its first start, before it answers, under the database's migration lock. Another server that starts meanwhile waits for that lock for up to 60 seconds, then stops if it is still held; start it again once the first is ready.

## Back up

The ledger and the workflows are in the same database, so the database's backups hold everything the runtime keeps, except content kept on [object storage](object-storage.md). Use your provider's automated backups and point-in-time recovery, or `pg_dump` for a server you run. Test a restore before you rely on it.
