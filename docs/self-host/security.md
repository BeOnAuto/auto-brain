# Authentication and security

Every request to the runtime comes from a caller. This page covers the tasks of the person who runs the server: letting people sign in, issuing API keys, using local mode and opening Studio. The [Sign-in and token reference](../reference/authentication.md) holds the protocol rules behind them.

The runtime recognizes three kinds of caller:

| Caller              | Who uses it                                                                                                 | How it authenticates                                                                                                  | What it may do                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A signed-in person  | People, through their agent, an agent gateway, Auto Studio or a page you allow                              | Signs in through the Auto identity service, then sends a token or a page's session as `Authorization: Bearer <token>` | Acts in the org they signed in to, over every playbook, with the permissions their token grants |
| An API key          | A machine, a pipeline or a trainer's agent that does not sign in, or any caller that needs a narrower grant | Sends a key listed in `API_KEYS` as `Authorization: Bearer <key>`                                                     | Acts in its one org, with the permissions and playbooks its entry lists                         |
| The local developer | You, on your own machine, in [local mode](#local-mode)                                                      | Nothing: every request is trusted                                                                                     | Acts with every permission in whichever org a request names                                     |

An [org](../concepts/terminology.md#orgs-and-callers) is the runtime's name for an organization in the Auto identity service.

## Who can call a server

Who can call a server follows from two settings, `PUBLIC_URL` and `API_KEYS`, and from the address the server listens on. There is no switch for it:

| Settings                                            | Where the server listens                                                       | Who can call it                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Neither `PUBLIC_URL` nor `API_KEYS`                 | A loopback address, as `npx @on.auto/runtime` and `pnpm dev` do on `127.0.0.1` | Anyone on this computer, as the local developer: [local mode](#local-mode)                              |
| Neither `PUBLIC_URL` nor `API_KEYS`                 | Any other address, as the Docker image does on `0.0.0.0`                       | Nobody: the server stops at start with a `ReachableWithoutCredentialsError` ([Local mode](#local-mode)) |
| `PUBLIC_URL`                                        | Any address                                                                    | People who sign in, and callers with a key that `API_KEYS` lists                                        |
| `API_KEYS` with at least one entry, no `PUBLIC_URL` | Any address                                                                    | Callers with a listed key                                                                               |
| `API_KEYS=[]`, no `PUBLIC_URL`                      | Any address                                                                    | Nobody: see [When the key list is empty](#when-the-key-list-is-empty)                                   |

So on your own machine, `npx @on.auto/runtime` and `pnpm dev` run in local mode with nothing set. To sign people in there, put `PUBLIC_URL=http://localhost:5555` in `.env` and start the server again. A container needs `PUBLIC_URL`, `API_KEYS` or both.

These paths need no caller, since nothing they return is secret:

- `/health`
- the OpenAPI document at `/v1/openapi.json`
- the guides at `/v1/guides/{guide}`
- the API catalog at `/.well-known/api-catalog`
- [the page the server shows a browser at `/`](#the-page-at-the-root)
- where sign-in is on, [the protected resource metadata](../reference/authentication.md#protected-resource-metadata)

## Let people sign in

People sign in through the Auto identity service at `https://clerk.on.auto`, the same service that signs them in to Studio. The first time a person's agent connects, it opens the service in their browser. They sign in and choose an organization.

`PUBLIC_URL` turns sign-in on. It is the URL at which people and their agents reach the runtime, and every access token must name it as its audience.

| Where the runtime runs                                         | What to set                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| On your own machine, with `npx @on.auto/runtime` or `pnpm dev` | `PUBLIC_URL=http://localhost:5555` in `.env`, then start the server again. Without it, the server runs in [local mode](#local-mode)                                |
| In a container you reach from the same machine                 | `PUBLIC_URL=http://localhost:5555`. Publish the port on `127.0.0.1` alone, as `--publish 127.0.0.1:5555:5555` does, so no other machine reaches it over plain HTTP |
| Behind a proxy                                                 | `PUBLIC_URL` set to the public address, such as `https://runtime.example.com`: the address of the proxy, not of the container                                      |
| Against the development instance of the identity service       | `IDENTITY_ISSUER` set to that instance, with `PUBLIC_URL` as above                                                                                                 |

Rules for `PUBLIC_URL`:

- It is an `https` URL with no path, query or fragment, such as `https://runtime.example.com`.
- It may instead be an `http` URL whose host is `localhost`, `127.0.0.1` or `[::1]`, whatever `HOST` is. That suits a runtime that people reach from the same machine.
- An `http` URL with any other host stops the start with an `InvalidSettingsError`, since a token sent over plain HTTP between machines can be read on the way. Any other value stops the start too.
- It has no default, since every access token names it as its audience. Whoever wants people to sign in sets it.
- Without `PUBLIC_URL`, the runtime signs no one in and serves no protected resource metadata. It accepts the keys `API_KEYS` lists where that is set. Otherwise it runs in local mode on a loopback address, and stops at start on any other address.

`IDENTITY_ISSUER` is an `https` URL with no path, query or fragment, and `https://clerk.on.auto` when not set. Any other value stops the start.

With sign-in on, the server checks the identity service before it accepts a request. It stops with an `UnusableIdentityServiceError` when it cannot use the service ([What the server checks at start](../reference/authentication.md#what-the-server-checks-at-start)). Once it has started, it logs which identity service people sign in through and which audience their tokens must name.

### Organizations

An org's id is its organization's id: a person who signs in to the organization `acme` acts in the org `acme`. The runtime keeps no list of people or orgs, since each token names its org.

A company whose people sign in through its own identity provider connects that provider to the identity service in Studio, not in the runtime. The runtime trusts one issuer, whichever provider a person used.

## What signed-in people can do

A signed-in person acts in their org, over every playbook. What they may do there depends on how they reach the runtime:

- Through an agent or an agent gateway, they send an access token. They have the permissions they granted on the identity service's consent screen.
- Through Studio, or a page at an origin you allow, they send a session. They have every permission in their org.

When the identity service stops issuing tokens to a person, the runtime refuses them once their last token expires. The workflow runs they started keep running, and a caller who may write to the playbook can cancel them ([What happens when access is revoked](../reference/authentication.md#what-happens-when-access-is-revoked)).

The [Sign-in and token reference](../reference/authentication.md) sets out the token forms, what a token must hold, [how scopes grant permissions](../reference/authentication.md#how-scopes-grant-permissions) and [the name recorded for a signed-in person](../reference/authentication.md#the-name-recorded-for-a-signed-in-person).

## API keys

Give each machine, pipeline or agent that does not sign in its own key. Use a key, too, for a grant narrower than a signed-in person's, such as reading one playbook. Each key belongs to one org and carries its permissions and the playbooks it may access. Give each key only what it needs, so you can revoke one without disturbing the others.

1. Create the key. With Docker, use the image your server runs, such as `onauto/runtime:0.9.1`:

   ```bash
   docker run --rm --log-driver none onauto/runtime:<version> node packages/identity/src/key-command.ts --org <org>
   ```

   Without Docker:

   ```bash
   npx @on.auto/runtime key --org <org>
   ```

   It prints the key and its entry, such as:

   ```text
   API key, shown only this once: abk_3e86c2be_...
   API_KEYS entry: {"id":"3e86c2be","sha256":"911afdd7...","org":"acme","permissions":["org:read","org:write","playbook:read","playbook:write"],"playbooks":"*"}
   ```

2. Copy the key somewhere safe. It is shown once: the server stores only its SHA-256.
3. Add the entry it prints to `API_KEYS`, or as one item of the `api_keys` list in the [configuration file](configuration.md). Write the variable unquoted, for example `API_KEYS=[{"id":"…",…}]` in an env file. Separate several entries with commas inside the brackets.
4. Restart the server. With Docker, replace the container, since `docker restart` does not read the environment file again. With the files of [Run with Docker](docker.md), that is `./start-runtime.sh`, or `docker compose up --detach --force-recreate runtime` with Compose.
5. Give the key to the caller, which sends it as `Authorization: Bearer <key>`; see [Use a key](#use-a-key).

`--log-driver none` keeps the key out of Docker's log driver, which could otherwise store or ship it. The command still prints the key to your terminal.

| Option          | Default                     | What it sets                                                                        |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `--org`         | required                    | The org the key belongs to, any org id but `local`                                  |
| `--id`          | 8 random hexadecimal digits | The key's id, 1 to 32 lowercase letters, digits and hyphens, other than `local`     |
| `--permissions` | all four                    | Comma-separated, from `org:read`, `org:write`, `playbook:read` and `playbook:write` |
| `--playbooks`   | `*`                         | Comma-separated playbook ids, or `*` for every playbook                             |

No key may use the id `local` or the org `local`. In the facts, `local` is the local developer's id, and the org `local` belongs to local mode.

Keep keys, like every other secret, in your platform's secret store, and pass them to the container as environment variables. The configuration file never holds a secret; it names the variable that does.

Keys work beside sign-in. [How a credential is read](../reference/authentication.md#how-a-credential-is-read) says how the runtime tells a key from a token.

### Use a key

A caller sends its key as a bearer token, over HTTP or to `/mcp`. These commands use the org `acme` on a server at `http://localhost:5555`:

```bash
curl --header 'authorization: Bearer <your key>' http://localhost:5555/v1/orgs/acme/playbooks
claude mcp add --transport http auto-runtime http://localhost:5555/mcp --header "Authorization: Bearer <your key>"
```

Codex reads the key from an environment variable:

```bash
export AUTO_RUNTIME_KEY=<your key>
codex mcp add auto-runtime --url http://localhost:5555/mcp --bearer-token-env-var AUTO_RUNTIME_KEY
```

### Revoke or rotate a key

Change `API_KEYS` and restart the server, or with Docker replace the container. A request with a key that is no longer listed gets `401`. To rotate a key without a gap, create its replacement and add its entry beside the old one, then restart. Move the caller to the new key, remove the old entry and restart again.

A workflow run keeps acting for the caller who started it, with the permissions that caller had then, until it ends. Revoking the key does not stop the run; `cancel_run` does.

### When the key list is empty

`API_KEYS=[]` is a list that is set and holds no key: keys were asked for, and none given. Without `PUBLIC_URL`, the server then admits nobody, on any address:

- It responds with `401` on every path except [the ones that need no caller](#who-can-call-a-server).
- It warns at start that no request can authenticate, because `API_KEYS` lists no keys.

## Local mode

Local mode is for one person on their own computer. No one signs in and no key is needed. Every request acts as the local developer, with every permission in whichever org it names. On `/mcp`, which names no org, the local developer acts in the org `local`.

There is no switch for local mode. A server is in local mode when both of these hold:

- it listens only on a loopback address: `localhost`, `::1`, or an address in `127.0.0.0/8` such as `127.0.0.1`;
- neither `PUBLIC_URL` nor `API_KEYS` is set, not even to `API_KEYS=[]`.

`npx @on.auto/runtime` and `pnpm dev` listen on `127.0.0.1`, so they run in local mode until you set `PUBLIC_URL` or `API_KEYS`. To sign people in on your own machine, put `PUBLIC_URL=http://localhost:5555` in `.env` and start the server again ([Let people sign in](#let-people-sign-in)).

> **Warning:** never run a server in local mode on a machine that can be reached through a proxy; set `PUBLIC_URL` or `API_KEYS` there. A reverse proxy on the same machine, such as nginx with its default settings, forwards remote requests to the loopback address with a localhost `Host` header. The server would trust every remote client as the local developer.

What local mode does:

- The server serves no protected resource metadata.
- It logs a warning at start that local mode is on, and says to set `PUBLIC_URL` or `API_KEYS` on a machine reachable through a proxy. The warning is at the `warn` level, which `npx @on.auto/runtime` prints only when `LOG_LEVEL` is `warn` or lower, since its default is `error`. The banner `npx @on.auto/runtime` prints when it is ready says that local mode is on, and gives the `PUBLIC_URL` that would sign people in.
- The credential a request presents is ignored. A request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` is refused `403`, which stops a web page from driving the server through a name that resolves to the loopback address. [Requests in local mode](../reference/authentication.md#requests-in-local-mode) has every rule.
- The facts your work records name the local developer as who did it. They keep that record after you turn sign-in on.

A server that listens beyond loopback, such as a container on `0.0.0.0`, with neither `PUBLIC_URL` nor `API_KEYS`, stops at start, before it listens. Its `ReachableWithoutCredentialsError` names the `HOST` it listens on: a server reachable beyond this computer needs `PUBLIC_URL`, to sign people in, or `API_KEYS`. With `API_KEYS` set, even to `[]`, or with `PUBLIC_URL` set, credentials are enforced on every address.

The Docker image cannot run in local mode, since it listens on every interface.

## Calling from a browser

A web page may call the API from Auto Studio, `https://studio.on.auto`, or from an origin you list in `ALLOWED_ORIGINS`. Studio is always allowed, so a runtime needs no setting for Studio to call it ([Open Studio on a runtime](#open-studio-on-a-runtime)).

- A request from a page at any other origin gets `403`.
- A request with no `Origin` header, such as one from a script or an agent, passes this check.
- An allowed page still sends a credential where credentials are enforced: a key, or the session of the person signed in to it.
- A page that sends a person's session acts as that person, with every permission in their org. So list in `ALLOWED_ORIGINS` only origins whose pages you trust as you trust Studio.

[Calls from a browser](../reference/authentication.md#calls-from-a-browser) in the reference sets out when a session is accepted and how the server responds to CORS requests.

## Secrets at rest

The runtime has a store for the secrets it must hold, such as the credentials of a connection, in the ledger's database, apart from the ledger's records and never in the clear. Each secret is sealed on its own as a JWE: a key made for that secret alone encrypts it with AES-GCM (`A256GCM`), and the secrets key wraps that key with AES key wrap (`A256KW`), so neither the database nor a backup of it holds a secret anyone can read without the secrets key, and the store hands a secret back only as a redacted value, which prints as `<redacted>`, so none reaches a log by accident. The secrets key is `SECRETS_KEY`, the base64 of 32 random bytes. With a ledger in SQLite and no `SECRETS_KEY`, the server makes a key at its first start, in `secrets.key` beside the ledger file with the mode `0600`, and reads it at every later start; a file that holds anything but such a key, or that others than its owner may read, stops the start, naming the file. That file keeps a copy of the database unreadable, but not a copy of the folder that holds both, so a container [sets `SECRETS_KEY`](production.md#keep-the-secrets-key) from its platform's secret store. A ledger in PostgreSQL, which several runtimes may share, needs `SECRETS_KEY`, and the server stops at start without it. At start the server logs the id of the key the secrets are sealed under, the first 16 hex characters of the key's SHA-256, and never the key. A secret sealed under a lost key cannot be read again by anyone, the runtime included, so keep a copy of the key with your other secrets, apart from the backups of the ledger; [Rotate the secrets key](production.md#rotate-the-secrets-key) replaces it.

## The page at the root

A browser that opens the server's address gets a page saying the server is running, with a button that opens Studio on it.

- The server returns the page only for a `GET /` that accepts `text/html`. It needs no key, in local mode or not.
- Any other request to `/` is treated like a request to any other path.
- The page tells a visitor only that an Auto Runtime server responds at that address. It shows nothing the server holds.
- It runs no script and asks no other server for anything. Its styles, its icon and its typefaces are inside it, and its `Content-Security-Policy` allows nothing else.
- It may not be shown in a frame, and it is never cached.

The button goes to `https://studio.on.auto/?server=<this server's origin>`. Studio then calls this server from the browser, which is why its origin is always allowed. Studio accepts the address in such a link only when it is on the visitor's own machine, so the button opens Studio only on a local runtime ([Open Studio on a runtime](#open-studio-on-a-runtime)).

## Open Studio on a runtime

Auto Studio calls the runtime from your browser, as you. Studio starts on `http://localhost:5555`. How you point it at another runtime depends on where that runtime is:

| Where the runtime is                                                   | How to open Studio on it                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| On your own machine: `localhost`, `127.0.0.1` or `::1`                 | Use the button on [the page at the root](#the-page-at-the-root), or the Studio link `npx @on.auto/runtime` prints when it is ready |
| Anywhere else, such as a team runtime at `https://runtime.example.com` | In Studio's settings, choose Change address under Runtime, then enter and save the runtime's `https` address                       |

- A `?server=` link works only for a runtime on the visitor's own machine. Studio ignores a link that names any other address, and says to enter that address in its settings.
- In its settings, Studio accepts an `https` address, or an `http` address on your own machine.
- Studio keeps an address only for its browser tab. A new tab starts on `http://localhost:5555` again.
- Studio sends your session, so a runtime elsewhere needs sign-in on, through `PUBLIC_URL` ([Let people sign in](#let-people-sign-in)). You then act in your org with every permission ([What signed-in people can do](#what-signed-in-people-can-do)).
