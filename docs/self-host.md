# Self-hosting

Auto Runtime is one server. Every release is published as the container image [`onauto/runtime`](https://hub.docker.com/r/onauto/runtime) on Docker Hub, for `linux/amd64` and `linux/arm64`, and as the npm package `@on.auto/runtime`. You can run it on one machine with Docker, or on any platform that runs Linux containers, and keep its records in a SQLite file or in PostgreSQL.

To try Auto on your own computer first, follow the [local quick start](get-started/local.md). It starts the same server with `npx @on.auto/runtime` and needs no deployment plan.

Auto Cloud is coming soon. [Request an invitation](https://on.auto/request-invite) if you would prefer a hosted playbook.

## What you need

| Need                   | Required                                     | What to use                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A place to run it      | Yes                                          | Docker, or any platform that runs Linux containers, such as Kubernetes or Amazon ECS. Without containers, Node.js 26.10 or later on macOS or Linux runs `npx @on.auto/runtime`                                                        |
| Storage for the ledger | Yes                                          | A volume for a SQLite file, for one server, or a [PostgreSQL](self-host/postgresql.md) database, for managed backups or several servers                                                                                               |
| Sign-in and API keys   | Yes, once others connect                     | `PUBLIC_URL`, the address people who sign in through the Auto identity service reach the runtime at, and an API key for each machine or pipeline, made with the key command; see [Authentication and security](self-host/security.md) |
| A model provider       | For reasoning functions                      | Anthropic, OpenAI or Google with an API key, Amazon Bedrock, Azure OpenAI, Google Vertex AI, or your own OpenAI-compatible gateway; see [Model providers and gateways](self-host/models.md)                                           |
| HTTPS                  | Before anything outside the machine connects | A reverse proxy or load balancer in front of the server's port, `5555`; see [Run in production](self-host/production.md)                                                                                                              |
| Object storage         | No                                           | An S3-compatible bucket, to keep uploaded datasets, model files and tool content out of the database; see [Keep content on object storage](self-host/object-storage.md)                                                               |

The ledger is the runtime's record of everything: playbooks, definitions, runs, their history and the workflows waiting on timers and events. Back it up as you would any production database.

## Choose a setup

- **One server with a volume.** The quickest start: the ledger is a SQLite file on a Docker volume. Back up the volume. [Run with Docker](self-host/docker.md) sets it up in three commands and signs you in.
- **One server with PostgreSQL.** Your database service takes the backups, and the container keeps nothing of its own. [Run with Docker](self-host/docker.md#run-with-postgresql) includes a Compose file with PostgreSQL beside the runtime; [Use PostgreSQL](self-host/postgresql.md) covers a managed database.
- **Several servers with PostgreSQL.** Every server answers requests; one of them runs the workflows, and another takes them over within seconds if it stops. Add [object storage](self-host/object-storage.md) when playbooks keep large datasets or model files.

## Guides

- [Run with Docker](self-host/docker.md): a first container, an agent connected and signed in, keys for machines and pipelines, and a Compose file with PostgreSQL
- [Use PostgreSQL](self-host/postgresql.md): get a database, create its user, connect over TLS, and sign in without a password on Amazon RDS
- [Keep content on object storage](self-host/object-storage.md): Amazon S3 or any S3-compatible store
- [Run in production](self-host/production.md): HTTPS and the public address, keys, memory, health checks, logs, upgrades and backups
- [Configure the runtime](self-host/configuration.md): every setting, the configuration file, and the tool servers functions may call
- [Model providers and gateways](self-host/models.md): credentials for each provider, gateways, aliases and allowed models
- [Authentication and security](self-host/security.md): sign-in, API keys, local mode and calls from a browser
- [Workflow operations](self-host/workflows.md): where runs are kept, how a server stops and restarts, and how several servers share the workflows
- [Send telemetry to an OpenTelemetry collector](self-host/telemetry.md): traces, metrics and logs over OTLP, what they record and what they leave out, and Grafana on your machine to read them
- [Troubleshooting](self-host/troubleshooting.md): error responses and common problems

## Plan your deployment with Xolvio

[Xolvio Professional Services](https://www.xolv.io/contact-us) can help you assess the deployment, connect your systems and establish an operating plan. Bring your requirements for data location, access, model providers and availability.

Your team will need to own infrastructure and updates, credentials and access controls, persistent storage and tested backups, monitoring, and recovery. Workflows run inside the runtime and keep their state in its database, so the database's backups cover them. Decide who can read recorded inputs and results, and which information can be sent to model providers.

Review [Function availability](concepts/functions.md#availability) and agree the support requirements of the version you plan to deploy before committing to a production workload. Auto Runtime is source-available under the Elastic License 2.0; review the repository's [licensing terms](https://github.com/BeOnAuto/runtime/blob/main/LICENSING.md) when planning a deployment.
