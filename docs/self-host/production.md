# Run in production

A production deployment is the container from [Run with Docker](docker.md), with HTTPS in front of it and its public address as `PUBLIC_URL`, a durable ledger, scoped keys, enough memory, and a plan for logs, upgrades and backups. This page goes through each.

Auto Runtime is in early development. Review [Function availability](../concepts/functions.md#availability) before you commit a production workload to it.

## Put HTTPS in front

The server speaks plain HTTP on `PORT`, `5555` unless set, on every interface (`HOST`, `0.0.0.0` in the image). Put a reverse proxy or a load balancer in front of it to end TLS, such as nginx, Caddy, Traefik, an ingress controller or your cloud's load balancer, and keep port `5555` itself off the internet.

Set `PUBLIC_URL` to the public `https` address people reach the runtime at, such as `https://runtime.example.com`, with no path. People sign in through the Auto identity service, and every access token must name that address as its audience, so it is the address of the proxy, not of the container; the `http` addresses `PUBLIC_URL` also takes, on `localhost`, `127.0.0.1` or `[::1]`, are for a runtime reached on its own machine. [Signed-in persons](security.md#signed-in-persons) sets out what the runtime verifies.

Never run a server in [local mode](security.md#local-mode) behind a proxy. Local mode trusts every request as the local developer, and a proxy on the same machine makes remote requests look local. The image cannot run in local mode anyway, since it listens on every interface: a server on such an address with neither `PUBLIC_URL` nor `API_KEYS` stops at start.

A web page may call the API only from Auto Studio or from an origin you list in `ALLOWED_ORIGINS`; see [Calling from a browser](security.md#calling-from-a-browser).

## Give every client its own key

A person signs in and needs no key. Make one [API key](security.md#api-keys) for each machine, pipeline or agent that signs in nowhere, and for each caller that needs a grant narrower than a signed-in person's, with only the permissions and playbooks it needs, so a key can be revoked without disturbing the others. To revoke or rotate one, change `API_KEYS` and restart the server: requests with a key that is no longer listed get `401`. A workflow run keeps acting for the caller who started it, with the permissions that caller had then, until it ends; revoking the key does not stop it, and `cancel_run` does.

Keep keys and every other secret in your platform's secret store, passed to the container as environment variables. The configuration file never holds a secret; it names the variable that does.

## Keep the ledger durable

The ledger holds every playbook, definition, run and its history, and the workflows waiting on timers and events.

- **SQLite on a volume** suits one server. Keep the volume on durable storage and [back it up](docker.md#back-up-and-restore).
- **[PostgreSQL](postgresql.md)** suits a managed database with automated backups, and is required for several servers.
- **[Object storage](object-storage.md)**, optional, keeps content such as datasets and model files out of the database. Back up the bucket with the database.

Whoever can read the database can read what the runtime recorded: the inputs and outputs of runs, the documents of workflows, and the arguments and answers of tool calls unless a tool server's entry sets `record_content: false`. Restrict access to it, and to its backups, accordingly.

## Run it as an always-on service

Workflows, their timers and retries, the deliveries of interaction functions and the folding of recall views all run inside the server. Run it as a long-lived service with a restart policy, and do not let your platform scale it to zero or pause it between requests, or waiting workflows stop moving until it wakes.

`/health` answers `{"status":"ok"}` without a key while the server is up. The image declares a Docker health check on it every 30 seconds; on Kubernetes, point the liveness and readiness probes at `GET /health` on port `5555`.

The server stops cleanly on `SIGTERM`: it finishes the work it already took, records where its workflows are, lets another server take them over, and exits, usually within a second. A call cut off by the stop runs again when a server next starts. A second `SIGTERM` or `SIGINT` ends it at once.

## Plan memory

Size the container's memory limit from the parts you use:

| Part                                    | Memory                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The server                              | About 180 MiB idle                                                                                                                                                                                                                                                                                           |
| Computation and recall workers          | Up to `COMPUTATION_WORKERS` threads, 4 unless set, each stopped past a 256 MiB heap and given a 64 MiB stack, so about 320 MiB each, 1.25 GiB for four at once                                                                                                                                               |
| Model processes of prediction functions | Up to `PREDICTION_PROCESSES`, 4 unless set, started only when needed; each is ended if it reserves more than `PREDICTION_PROCESS_MEMORY`, 1,280 MiB unless set, and stays far below that: about 160 MiB before it loads a model and about 650 MiB at the peak of walking a 64 MiB model over the widest rows |

Reasoning functions and workflows run in the server itself; computation, recall and prediction functions add their workers and processes while they run. Watch the container's memory under your own load and set the limit with room above the peak. [Configure the runtime](configuration.md#settings) lists the settings that bound each part.

## Run several servers

Several servers can share one PostgreSQL database and one bucket behind a load balancer. Every server answers requests. One runs the workflows and the others stand by; if it stops or dies, another takes them over within about three seconds. While a server stands by, it answers workflow operations `unavailable`, saying another server runs them. [Workflow operations](workflows.md) describes the claim and what each server logs.

## Read the logs

In the image, the server writes one JSON object per line to stderr, with a `level`, a `message` and the annotations of what it describes. Collect stderr with your platform's log driver. `LOG_LEVEL` sets the least level written, `debug`, `info`, `warn` or `error`, `info` unless set.

At start the server logs where the ledger and content are kept, which model providers are configured, and the limits it runs with, and warns about anything missing; a setting it cannot read stops it, naming the setting and never its value. An error response with status `500` carries an incident id, which the server logs with the error and the request's `x-request-id`, so either id finds it; see [Troubleshooting](troubleshooting.md#error-responses).

To see how requests, runs and calls of models and tools took their time, [send telemetry to an OpenTelemetry collector](telemetry.md). With telemetry on, every response carries its trace's id in `x-trace-id`, and a line the server logs while it answers a request names that trace in `trace_id`.

## Upgrades

Pin a full version, such as `onauto/runtime:0.9.1`, and upgrade on purpose: read the [release notes](https://github.com/BeOnAuto/runtime/releases), pull the new tag and replace the container. The new server migrates the ledger at start.

Servers of different versions never share a database at the same time. With several servers, stop every server of the old version, then start the new ones. A version that adds a table fills it at its first start, before it answers; other servers that start meanwhile wait up to 60 seconds for it.

## Reach models and tools through your network

The server calls model providers and the tool servers you configure. Behind an outbound proxy, set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`, with `NO_PROXY` for the hosts to reach directly; for a private certificate authority, mount its certificate and name it with `NODE_EXTRA_CA_CERTS`. [Model providers and gateways](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) has an example.

## The image

The image is built on `node:slim` for `linux/amd64` and `linux/arm64`. It runs as the user `node`, which can read but not change the runtime's code and may write only to `/data`, `/tmp`, `/var/tmp`, `/run/lock` and its home, `/home/node`. `tini` runs as process 1 and passes signals to the server. The image carries no npm or npx, which the server never runs. Each release is built in GitHub Actions with a software bill of materials and provenance attached, and an [OpenVEX](https://openvex.dev) document, `packages/server/container.vex.json` in the image, names the scanner findings that do not apply to it, with the reason for each.
