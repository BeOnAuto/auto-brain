# Authentication and security

## API keys

Every path needs an API key, sent as `Authorization: Bearer <key>`, except `/health` and [the page the server shows a browser at `/`](#the-page-at-the-root). Each key belongs to one org and carries its permissions and the brains it may access. The key command creates one:

```bash
docker run --rm --log-driver none beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org <org>
```

Options are `--id`, `--permissions` (comma-separated, from `org:read`, `org:write`, `brain:read`, `brain:write`; all four by default) and `--brains` (comma-separated brain ids, or `*` for every brain, the default). The command prints the key once and the entry to add to `API_KEYS`, or to `api_keys` in the [configuration file](../self-host/configuration.md), where the entry as printed is one item of the list; only the key's SHA-256 is stored, so keep the key itself somewhere safe. Write the variable unquoted, for example `API_KEYS=[{"id":"…",…}]` in an env file. `--log-driver none` keeps the key out of Docker's log driver, which could otherwise store or ship it; the command still prints it to your terminal.

Following [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750), a request without an `Authorization` header gets `401` with `WWW-Authenticate: Bearer`, a key that is not valid gets `401` with `error="invalid_token"`, an `Authorization` header that is not exactly one `Bearer <key>` gets `400` with `error="invalid_request"`, and a key that lacks the permission, brain or org a call needs gets `403` with `error="insufficient_scope"`.

Without `API_KEYS`, or with `API_KEYS=[]`, and without local mode, the server rejects every path except those two with `401`, on any address, and warns at start-up that no request can authenticate.

## Local mode

Local mode is for development on your own machine. It is on only when `LOCAL_MODE=true`, the server listens only on a loopback address (`localhost`, `127.0.0.1` or `::1`), and `API_KEYS` is not set. Then every request acts as a local developer with every permission in whichever org it names, and no key is needed; the server logs a warning saying so when it starts. To stop a web page from driving it, local mode rejects a request whose `Host` header is not a localhost name, and, as always, a request whose `Origin` is neither the studio's nor in `ALLOWED_ORIGINS`.

> **Warning:** never enable local mode on a machine that can be reached through a proxy. A reverse proxy on the same machine, such as nginx with its default settings, forwards remote requests to the loopback address with a localhost `Host` header, so the server would trust every remote client as the local developer.

`LOCAL_MODE=true` with an address that is not loopback stops the server at start-up with an `InvalidLocalModeError`. With `API_KEYS` set, keys are enforced and the server warns that `LOCAL_MODE` is ignored. `pnpm dev` sets `LOCAL_MODE=true` and listens on `127.0.0.1`, so it runs in local mode; `pnpm key -- --org <org>` creates a key from a checkout.

## Calling from a browser

A page may call the API only from the studio, `https://studio.on.auto`, or from an origin listed in `ALLOWED_ORIGINS`; a request with any other `Origin` header gets `403`. The studio origin is always allowed. Being allowed lets a page reach the API, not act on it: where keys are enforced, the studio still has to send one. In local mode no key is needed, so a script served from `https://studio.on.auto` can act as the local developer. For an allowed origin the server answers CORS: a preflight (`OPTIONS` with `Access-Control-Request-Method`) gets `204` before any key is checked, allowing `GET`, `HEAD`, `POST` and `PUT` with the `authorization` and `content-type` headers, and every response carries `Access-Control-Allow-Origin` with that origin, `Vary: Origin`, and `x-request-id` among the headers the page may read. There is no wildcard and no credentials mode: the page sends its API key in the `Authorization` header.

## The page at the root

A browser that opens the server's address gets a page saying the server is running and showing its address. The page says Auto Studio is invite-only and offers a button to request an invite. The server answers with the page only to a `GET /` that accepts `text/html`, and it needs no key, in local mode or not. Any other request to `/` is treated like a request to any other path.

The page tells a visitor only that an auto-brain server answers at that address; it shows nothing the server holds. It runs no script and asks no other server for anything: its styles, its icon and its typefaces are inside it, and its `Content-Security-Policy` allows nothing else. It may not be shown in a frame, and it is never cached.

The button goes to `https://on.auto/request-invite` without sending the server address or other parameters.
