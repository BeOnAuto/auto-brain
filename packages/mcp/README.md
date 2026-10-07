# @beonauto/mcp

How a brain reaches the outside world: the MCP servers the operator configures, and the tools a run is offered from them, as [decision 0003](../../docs/decisions/0003-mcp-servers.md) sets out. The server reads the settings and makes one `ToolAccess` at its composition root, which it gives to both capabilities that reach a tool: the reasoning function adapter opens a run's tools through it when a reasoning function names `tools`, and runs the model's tool loop over what it gets back; the interaction function adapter delivers a request through a channel of the type `mcp` with one call of one tool; and `list_tool_servers` lists through it the servers a brain may use and their tools.

## Entry points

- `@beonauto/mcp`: the settings, `makeToolAccess` and `defineListToolServers`. The access loads the MCP client, its OAuth providers and `node:child_process` (`src/access/linked-access.ts`) through a dynamic import when a run first opens its tools or a listing first asks a server, so a server that never does either never loads them: the server's start loaded 55 files and 0.94 MiB more with them (measured 2026-10-06 with a module load hook, 1,241 files against main's 1,186). Without them it loads 20 files and 42 KiB of this package, the operation `list_tool_servers` among them (measured 2026-10-07 with a module load hook over both entries, against 15 files and 32 KiB before the operation).
- `@beonauto/mcp/policy`: the pure helpers a caller needs without connecting to anything (`toolReferenceOf`, `toolReferenceShape`, `writtenOf` and `runBoundMs`). It loads no transport code, so the reasoning function adapter, which parses a function's `tools` and bounds its run, does not load the MCP client wherever it is bundled; it takes `ToolAccess` as a type only.
- `@beonauto/mcp/testing`: the fake server and the helpers of the tests (see Testing).

## Settings

`readMcpSettings(environment, { modelProviders })` reads two settings, each JSON, which the server also writes from the configuration file's `mcp_servers` and `allowed_tools`:

- `MCP_SERVERS`: an object with one entry per server, keyed by the name a reasoning function writes in `server/tool`.
- `ALLOWED_TOOLS`: a list of `server/tool` and `server/*`, the tools a reasoning function may name. Every tool of every server when it is left out.

| Field            | Of    | What it holds                                                                                                                                 |
| ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | both  | `http` or `stdio`; taken from `url` or `command` when left out                                                                                |
| `url`            | http  | The http or https URL of a server spoken to over Streamable HTTP                                                                              |
| `headers`        | http  | Headers sent with every request; the values of their references are secrets                                                                   |
| `auth`           | http  | OAuth client credentials: `issuer`, `client_id`, `client_secret` or `private_key` with `algorithm`, and `scope`                               |
| `command`        | stdio | An installed, pinned command, never a package downloaded at start such as `npx -y`                                                            |
| `args`           | stdio | The arguments of the command                                                                                                                  |
| `env`            | stdio | The whole environment of the process, the values of its references secrets: it inherits nothing else, so give `PATH` or an absolute `command` |
| `org`            | both  | The org the server serves, required                                                                                                           |
| `brains`         | both  | The brains of the org it serves; every brain of the org when left out                                                                         |
| `record_content` | both  | `true` to record the arguments and results of calls, cut to 4 KiB, on the run; `false` when left out                                          |
| `request_id`     | both  | The response header, or the key of the metadata of a result, in which the server carries its own id of a request, recorded with each call     |

A secret is a value resolved from a `${NAME}` reference to the environment when the settings are read, an `auth` credential, or a token minted from one, and nothing else: a header such as `X-Region: production-eu` or an environment value such as `MODE=production` is not, and is never scrubbed. The scrubber (`src/bounds/secrets.ts`) replaces each secret as written, as it is written inside a JSON string, where a quote, a backslash or a line break in it is escaped, and as it is written inside JSON twice, as in a result whose text content is itself JSON, so a secret in the recorded arguments or result of a call is caught too. A value shorter than 8 characters is never scrubbed, since replacing it would erase ordinary words in every message; a reference that resolves to one is still a secret in every other sense, and the operator gives a server a key at least that long. Only `headers`, `env` and `auth` may hold a reference: one in `url`, `command` or `args` is refused with its pointer, since a key in an argument shows in the listing of the machine's processes and a key in a URL is not a header. A value that looks like a credential written out is refused, as a model gateway's key is, and so is a password in a `url`, and a user, a query value or the part of an argument after its `=` that looks like one, as in `--key=sk-live-...`; a value is judged by what it holds, never by the name it is given, so `--token-file=/run/secrets/notes` and `?token_type=bearer` are accepted. The settings also refuse an entry with neither `url` nor `command` or with both, a name outside 1 to 32 lowercase letters, digits and hyphens starting with a letter, the name of a model provider or gateway, a missing org, an org or brain that is not an id, an `Authorization` header beside an `auth` block, an issuer that is not https (or http on a loopback address), a header the MCP client sets itself, the fields of the other type, and an `ALLOWED_TOOLS` entry that names no configured server. Each problem names its setting and a JSON pointer, never a value; `McpSettingsInvalid` carries them all.

Nothing is learned from a server when the settings are read: the server starts without the network and without spawning anything.

## A run's tools

`makeToolAccess(settings, { reportServerMessage, fetch?, now?, timing? })` holds one link per configured server and answers:

- `configured`: whether any server is configured, which makes `execute_spec` destructive.
- `open(execution, references)`: the tools of one run, for the execution's id, org, brain and journal, and the `server/tool` references its reasoning function names.
- `callOnce(call)`: one call of one tool for a delivery (see [One call for a delivery](#one-call-for-a-delivery)).
- `listServers(brain, named?)`: the servers that serve the brain, or only the one named, with their tools (see [Listing the tool servers](#listing-the-tool-servers)).
- `close()`: ends every session and stops every process, when the server stops.

`open` fails with `ToolNotOffered` when a reference names a server not configured for the execution's org and brain (`mcp_server_not_configured`), a tool the operator does not allow (`tool_not_allowed`), or a tool its server does not list (`tool_not_listed`), and with `McpServerFailed` when a server cannot be used (`unreachable`, `failing` or `rate_limited`). Otherwise it connects to each named server, lists its tools once, and keeps that listing for the run: a `list_changed` notification changes nothing, and a call to a tool the server no longer has is a tool error. `server/*` offers every listed tool the operator allows.

`RunTools` offers each tool under its model-facing name, `mcp__server__tool`, with characters outside letters, digits and underscore mapped to underscores, cut to 64 characters with an 8-character hash when longer or when two names would collide. A numeric suffix resolves any remaining collision, so every tool offered in a run has a distinct name. Its description is cut to 4 KiB and the server's input schema is unchanged. It also says whether the calls have ended (`callsEnded`, `ended`, `ending`), whether the run called any tool (`calledAny`), and the tools it used in words (`usedInWords`), and lets the run's servers go (`close`).

A call of an offered tool:

1. is refused as a tool error, never sent and never recorded, when the run's calls or results are spent, its arguments are too large, or it repeats a call made twice already;
2. records `tool_call_started` through the run's journal, which answers the number the run's record gave the call, and is not sent if that fails;
3. is forwarded with the execution id in the request's metadata under `com.beonauto/execution_id`, within its deadline, waiting out a 429 whose `Retry-After` fits the longest wait, opening a session the server forgot once, and restarting a `stdio` process that exited once per run;
4. records `tool_call_answered`, unless the run was cancelled meanwhile;
5. answers the model: text content as text, structured content only when there is no text, other content as a one-line placeholder, an `isError` result as a tool error, and a failure as a tool error naming the server, all scrubbed of the entry's secrets and minted tokens. A server's `instructions` never reach the model.

A server failure is also reported to the operator through `reportServerMessage`, bounded and scrubbed, and the fifth ends the run's calls, with `ending()` saying `failing` or `rate_limited`.

## One call for a delivery

`callOnce({ org, brain, executionId, deliveryId, reference, input })` makes one call of one tool for a delivery of an interaction function's request, with bounds of its own, `deliveryBounds`, and never records a tool call: the delivery records its own attempt. It shares the server's link with the runs, so it waits for a session to open no longer than the connection bound of a delivery, 10 s, or the shared opening bound when that is shorter (`connectionBoundOf`), and ends a delivery past it `timed_out`, letting go of a session that opens later; it waits no longer either to open a forgotten session again or to start an exited process again (`boundedSlot`); it lists no tools: a tool the server no longer has is a tool error. The call carries the run's id under `com.beonauto/execution_id` and the delivery's id under `com.beonauto/delivery_id` in its metadata, the same id on every attempt of one request, so a receiver can tell an attempt it already took. It answers:

- `result`, with what the tool answered, its `content` and `structuredContent` as JSON, scrubbed and cut at 4 KiB at a character, and the size of all of it;
- `tool_error`, an `isError` result or a tool the server refuses, such as a gateway's denial or a tool it no longer has; `server_failure`, a server that cannot be reached, fails or asks to slow down, with the wait a 429 asked for in `retryAfterMs`, which the delivery's schedule honours, since the call itself never waits one out; `timed_out`, after 30 s; each with a detail cut at 1 KiB and scrubbed;
- `not_offered`, sent nowhere, for a server not configured for the brain's org and brain or a tool the operator does not allow.

## Listing the tool servers

`defineListToolServers(access)` makes `list_tool_servers`, `GET /tool-servers` relative to the brain, under `brain:read`, which reaches outside (`openWorldHint` over MCP). It answers `{ tool_servers }`: each server that serves the brain's org and brain, sorted by name, as `{ name, type, tools }`, or `{ name, type, unavailable }` for a server that could not be asked, whose words say why. `server` keeps only the server of that name, and asks no other; a name that no server serving the brain has is `invalid_input` at `/server`, whose words say so and to call it without `server`.

`listServers` lists as `open` does, through the same link (`connectedTo` in `src/access/server-listing.ts`), under the same bounds: it takes a connection, lists the server's tools within `openMs`, and lets the connection go, so an `http` session no run holds is ended once the listing has its tools, and a `stdio` process is started when no run started it and kept until `close()`. Listings made at once share the link's connection, as runs do, and one listing of an `http` server no run holds costs it five requests when the server issues a session id: initialize, its notification, the stream `GET`, `tools/list` and the `DELETE` that ends the session. A server that issues none gets four, since the MCP client sends the `DELETE` only for a session it was given. A listing interrupted meanwhile still lets its connection go once the server answers. The tools are those `server/*` would offer a run (`offeredOn`): what the server lists that `ALLOWED_TOOLS` allows, in the server's order, each with its `name`, its `description` cut to 4 KiB as a run cuts it, and its input schema as `input_schema`. A server on which `ALLOWED_TOOLS` allows no tool is `{ name, type, tools: [] }` and is never asked, since a run naming `server/*` there is refused `tool_not_allowed` before it connects (`isAllowed`). A server that cannot be used is `unavailable` with the words `McpServerFailed` would carry, cut to 4 KiB, and the other servers are listed beside it. The listing adds no header, environment value, URL, command or credential of its own; what a server writes, the names, descriptions, the keys and values of input schemas and the words of a failure, is passed on scrubbed of every entry's secrets and minted tokens before it is cut, and, as everywhere, a secret shorter than 8 characters is never scrubbed. When no server serves the brain, it answers an empty list without loading the MCP client.

## Connections

Each entry has one link. An `http` link opens a session when a run or a listing first needs it, shares it with every run and listing that holds it while it is open, and ends it explicitly when the last of them lets it go. Session termination is bounded by the connection timeout; the client closes even if the remote DELETE never answers. A `stdio` link starts its process on first use and keeps it until `close()`; it spawns the command without a shell, with the entry's `env` and nothing else, reports each line the process writes to stderr (at most 100 lines of 2000 characters), and takes at most 4 MiB of output at once. Closing a process ends its input, and kills it through its handle after two seconds.

With an `auth` block, tokens come from the MCP client's client-credentials or private-key provider, with the issuer pinned: the client sends the credential to no authorization server whose metadata names another issuer. One token is minted for every concurrent run, renewed a minute before it expires (or halfway through a shorter life), and minted again once when the server answers 401; a second 401 is a failure. Every remote request goes through the `fetch` given, the server's outbound fetch, so `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` apply, and a certificate the server does not trust is a fixed message.

The MCP client has no logging option. The errors it meets, such as a line from a process that is not JSON-RPC or a stream it could not read, reach the client's `onerror`, which reports them through `reportServerMessage` as the messages of their server, scrubbed. They are bounded as the stderr of a `stdio` process is: at most 100 of 2000 characters for each process started or session opened, then one line saying the rest is not shown. The few warnings it writes to the console about how it was configured are left on stderr: catching them would mean patching the global console of the whole server, which every other library writes to as well.

## Bounds

`toolBounds` holds them; `timing` replaces the three durations in tests.

| Bound                                                                   | Value                      |
| ----------------------------------------------------------------------- | -------------------------- |
| Tool calls in one run                                                   | 25                         |
| Tool results sent to the model in one run                               | 256 KiB                    |
| One result, as the model sees it                                        | 64 KiB, cut with a note    |
| One call's arguments                                                    | 16 KiB                     |
| The same tool with the same arguments                                   | twice                      |
| Server failures in one run                                              | 5                          |
| The longest wait a 429 may ask                                          | 10 s                       |
| One call                                                                | 30 s                       |
| Opening a connection, or starting a process, and then listing its tools | 10 s each                  |
| A whole run (`runBoundMs`)                                              | 10 min, or one step longer |
| A tool's description, and recorded content                              | 4 KiB each                 |

## What is recorded

`tool_call_started` carries the call's number in the run, the id the model gave it, the server and tool, and the size and SHA-256 digest of the arguments as `JSON.stringify` writes them. `tool_call_answered` carries the number, the outcome (`result`, `tool_error`, `server_failure`, `timed_out` or `cancelled`), the size and digest of the result's content, its `content` and `structuredContent` as the client hands them back, re-serialised, never its `_meta` or `isError`, the duration and the JSON-RPC id. An entry with `request_id` adds the server's own id of the request; one with `record_content: true` adds the arguments and the result's content, scrubbed and cut to 4 KiB as they are stored, a JSON string whose escapes count.

## Testing

`@beonauto/mcp/testing` holds a fake MCP server built with the MCP server package:

- `serveFakeMcp({ bearer?, client?, requestIdHeader? })` serves it over Streamable HTTP on a loopback port the system picks, with a bearer check or a fake authorization server, sessions, and ways to answer the next requests with a status (`answerNextWith`, for a 429 with `Retry-After`), answer the next tool call after messages that are not JSON-RPC (`answerNextCallAfterNoise`), forget every session (a 404), revoke tokens (a 401), remove a tool and send `list_changed`. A request its handler fails on is answered with a 500 and recorded in `failures()`, beside the requests in `seen()`, instead of rejecting where no test awaits it.
- `fakeStdioServerPath` runs the same tools over stdio under `node`, with `--chatter`, `--pad`, `--stdout`, `--linger-ms` and `--start-once` to make it talk, misbehave or fail to start again. Start it with `process.execPath` directly, never through a package manager: it imports only the MCP server package and the fake's tools, not `effect`, and answers its first message in about 90 ms on a laptop. A spawn is real time, so a test that starts it takes `stdioTestTimeoutMs`, 30 s, and its connection `patientTiming`, and a file shares one process across the tests that only need it running.
- Its tools answer text (`search`, `echo`, `graph.query.v2`), structured content (`profile`), non-text content (`photo`), a denial marked `isError` (`denied`), an error (`broken`), slowly (`sleep`), at length (`large`), with its environment (`environment`), or by exiting (`exit`).
- `openFakeToolRun`, `reportingAccess`, `recordingCallJournal`, `toolRun`, `controlledSignals` and `inTurn` open a run's tools against it.
- `recordingTimer` stands in for the timer a link's options take, which bounds the end of a session: it records each wait and whether it was stopped, so a test of that deadline touches no global timer. `fetchWithDeletion` sends a session's `DELETE` to a handler of the test's own.

## A manual run against an agent services gateway

The tests never call a real gateway. Once, before relying on one, run a reasoning function against it by hand:

1. In the gateway, create an application for the brain and an API key for it, and attach a policy that allows the reads the run needs and denies one field you can name.
2. Export the key as `GRAPH_API_KEY` where the server runs. It never goes in the configuration file.
3. Configure the gateway as an `http` entry:

   ```yaml
   mcp_servers:
     graph:
       url: https://gateway.example.com/mcp
       headers:
         Authorization: Bearer ${GRAPH_API_KEY}
       org: acme
       brains: [sales]
   allowed_tools: [graph/search, graph/introspect, graph/validate, graph/execute]
   ```

4. Start the server and create a reasoning function in that brain with `tools: [graph/*]` whose prompt asks a read-only question the policy allows, including the denied field.
5. Run it with `execute_spec`, then read the run with `get_execution_history`.

Check that the run succeeded; that its history shows a `tool_call_started` and a `tool_call_answered` for each call, the denial answered as `tool_error` and the model's answer saying the field was withheld; that the gateway's audit shows the calls made by the application, each carrying the run's id under `com.beonauto/execution_id`; that `execute_spec` for the same `execution_id` answers the same run again; and that the server's log holds no key or token.
