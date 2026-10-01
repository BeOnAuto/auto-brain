# auto-brain

**The runtime for business brains.**

[![CI](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/BeOnAuto/auto-brain/badge)](https://scorecard.dev/viewer/?uri=github.com/BeOnAuto/auto-brain)
[![License: ELv2](https://img.shields.io/badge/license-ELv2-blue)](LICENSING.md)

A business brain carries out the way your team works. It gathers context, calls models, runs deterministic steps, and asks people or systems for input when it needs it. Every step lands on a ledger, so the brain's work can be recalled, explained and improved.

auto-brain is the server a brain runs on. Auto can host it for you, or you can run it yourself from one container image.

> **Status: early development.** The server, its container image and the release pipeline are in place, and the server can create, list, read, update and retire an org's brains on the ledger. The primitives below are being designed and built, so auto-brain isn't ready for production use yet.

## How a brain works

A brain is made of **primitives** that share one **ledger**.

| Primitive                                 | What it does                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Interaction](primitives/interaction)     | Input and output between the brain and people or machines, in both directions                                                                                       |
| [Orchestration](primitives/orchestration) | Deterministic steps that run other primitives, triggered by an event, by hand or on a schedule                                                                      |
| [Inference](primitives/inference)         | An LLM call defined in Markdown: front matter sets the model, skills, tools and input and output schemas; a Liquid body pulls in context from the rest of the brain |
| [Prediction](primitives/prediction)       | A machine-learning model that makes a prediction, for when an LLM isn't the right tool                                                                              |
| [Computation](primitives/computation)     | A deterministic function that workflows and agents can call                                                                                                         |
| [Recollection](primitives/recollection)   | A materialized view of the brain's history, built from the ledger                                                                                                   |
| [Dream](primitives/dream)                 | Explores the ledger around a subject to suggest new scenarios and better ways of working, and can iterate towards a goal                                            |

The [ledger](packages/ledger) records every input and output of every primitive. That record lets a brain recall what happened and explain its decisions. It also lets you evaluate and improve the method over time.

```mermaid
flowchart TD
    people(["People"]) <--> interaction["Interaction"]
    machines(["Machines"]) <--> interaction
    triggers(["Events, manual runs and schedules"]) --> orchestration
    interaction --> orchestration["Orchestration"]
    orchestration --> inference["Inference"]
    orchestration --> prediction["Prediction"]
    orchestration --> computation["Computation"]
    interaction & orchestration & inference & prediction & computation --> ledger[("Ledger")]
    ledger --> recollection["Recollection"]
    ledger --> dream["Dream"]
    recollection -. context .-> inference
```

## Where it fits

Three separate things:

- **Auto Studio** is the management plane at [on.auto](https://on.auto), with governance and observability for your brains.
- **Cloud hosting** means Auto runs auto-brain for you, so there's no infrastructure to operate.
- **Self-hosting** means you run the same image on your own infrastructure, free up to a usage threshold (see [Licensing](#licensing)).

## Run it

### Quick start

From a checkout, `pnpm dev` runs the server in [local mode](#local-mode), so it needs no key. Create a brain, then read it back:

```bash
pnpm install
pnpm dev
curl --request POST http://localhost:8080/v1/orgs/acme/brains \
  --header 'content-type: application/json' \
  --data '{"brain":"sales","name":"Sales","description":"Answers questions about the pipeline"}'
curl http://localhost:8080/v1/orgs/acme/brains
curl http://localhost:8080/v1/orgs/acme/brains/sales
```

`PUT /v1/orgs/acme/brains/sales` replaces the name and the description, and `POST /v1/orgs/acme/brains/sales/retire` retires the brain for good. `pnpm dev` keeps the ledger in `packages/server/.data/ledger.db`, so the brains are still there after a restart.

### In a container

Every release publishes the image to Docker Hub (`beonauto/auto-brain`) and GitHub Container Registry (`ghcr.io/beonauto/auto-brain`). A container needs two things: an [API key](#api-keys), because it listens on every interface, and a volume on `/data`, where it keeps the ledger.

```bash
docker run --rm beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org acme
echo 'API_KEYS=[<the API_KEYS entry it printed>]' > auto-brain.env
docker volume create auto-brain-data
docker run --rm --publish 8080:8080 --env-file auto-brain.env --volume auto-brain-data:/data beonauto/auto-brain:latest
curl --header 'authorization: Bearer <the key it printed>' http://localhost:8080/v1/orgs/acme/brains
```

Without a named volume, Docker gives each container a fresh anonymous volume, so its brains last only as long as that container.

| Variable          | Default                                          | Purpose                                                                                     |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `PORT`            | `8080`                                           | Port the server listens on                                                                  |
| `HOST`            | `0.0.0.0`                                        | Interface the server binds to                                                               |
| `ALLOWED_ORIGINS` | none                                             | Comma-separated origins allowed to call the server from a browser                           |
| `API_KEYS`        | none                                             | The API keys the server accepts, as a compact JSON array of entries made by the key command |
| `LEDGER_FILE`     | `data/ledger.db`; `/data/ledger.db` in the image | The SQLite database file of the ledger; its directory is created when missing               |

The image is multi-arch (amd64 and arm64), runs as a non-root user, keeps the ledger on the `/data` volume, and shuts down cleanly on `SIGTERM`.

### API keys

Every path except `/health` needs an API key, sent as `Authorization: Bearer <key>`. Each key belongs to one org and carries its permissions and the brains it may reach. The key command creates one:

```bash
docker run --rm beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org <org>
```

Options are `--id`, `--permissions` (comma-separated, from `org:read`, `org:write`, `brain:read`, `brain:write`; all four by default) and `--brains` (comma-separated brain ids, or `*` for every brain, the default). The command prints the key once and the entry to add to `API_KEYS`; only the key's SHA-256 is stored, so keep the key itself somewhere safe. Write the variable unquoted, for example `API_KEYS=[{"id":"…",…}]` in an env file.

Without `API_KEYS`, a server that listens on all interfaces, as the container does, refuses every path except `/health` with `401`.

### Local mode

When the server listens only on a loopback address (`localhost`, `127.0.0.1` or `::1`) and `API_KEYS` is not set, it runs in local mode: every request acts as a local developer with every permission in whichever org it names, and no key is needed. To stop a web page from driving it, local mode refuses a request whose `Host` header is not a localhost name, and, as always, a request whose `Origin` is not in `ALLOWED_ORIGINS`. `pnpm dev` listens on `127.0.0.1`, so it runs in local mode; `pnpm key -- --org <org>` creates a key from a checkout.

### Errors

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document (`application/problem+json`) with a machine-readable `reason`, such as `bad_request`, `invalid_input` (with an `errors` list of JSON pointers), `forbidden`, `not_found` or `conflict`. A `500` says nothing about the cause; its `instance` is `urn:uuid:<id>`, and the server logs the error to stderr under `"incident":"<id>"`, so the id in the response finds the log line.

## Licensing

auto-brain is **source-available** under the [Elastic License 2.0](LICENSE), the same model Apollo uses for its GraphQL router.

- Self-hosting is free up to a usage threshold. Above it, you need a commercial license from Auto.
- You can't offer auto-brain to others as a hosted or managed service.

[LICENSING.md](LICENSING.md) explains what's allowed, when you need a license, and how to get one.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). You'll sign the [CLA](CLA.md) on your first pull request, and everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Local development needs Node 26 and pnpm 12:

```bash
pnpm install
pnpm dev          # server on http://localhost:8080, reloading on save
pnpm test:watch   # tests on save
pnpm check        # everything CI checks
```

## Repository layout

| Path                  | What's there                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/server`     | The HTTP server (`@beonauto/server`), which serves the brain operations on the ledger, and its container build (`Dockerfile`) |
| `packages/api`        | The API (`@beonauto/api`) the server answers every request with                                                               |
| `packages/config`     | Reads the server's configuration from the environment                                                                         |
| `packages/identity`   | API keys, local mode and the key command                                                                                      |
| `packages/operations` | The application layer: where operations are defined and run                                                                   |
| `packages/brains`     | The brain operations: create, list, read, update and retire an org's brains                                                   |
| `packages/ledger`     | The ledger every primitive records to: event streams on Emmett and SQLite                                                     |
| `primitives/*`        | One package per primitive                                                                                                     |
