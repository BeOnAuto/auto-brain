# Let people add connections

A connection is a tool server that a person adds to an org through their agent, rather than one you set up in Auto's settings file. The org owns it, and every playbook of the org may use it, or only the playbooks it names. The person approves it, and gives its credential where it takes one, on a page of Studio. The agent never sees the credential.

This page is for whoever runs Auto. It says how a connection is added, what it holds, and the rules you set for it in `auto-runtime.yaml`. A tool server you set up yourself is still added as [Add a tool server](tool-servers.md) shows.

Functions do not call the tools of a connection yet: `search` lists the tool servers of the settings file alone. This release keeps connections and their credentials, so people can add, approve, list and remove them; a later release lets functions call through them.

## How a person adds a connection

1. The person asks their agent to connect a tool server, such as their CRM. The agent calls `add_connection` with the server's address, its options and how it is credentialled, never the credential itself.
2. Auto keeps the connection, `pending`, and answers with a link to Studio's page, `https://studio.on.auto/connect`, which lasts ten minutes. An agent whose client opens links asks the person to open it; any other agent gives the person the link from its answer.
3. On the page, signed in, the person approves the connection. Where it takes a secret or client credentials, the person types the credential there, and giving it approves the connection. The connection is then `connected`.

On a runtime that signs people in, only the person who added a connection may approve it, signed in as themselves. In [local mode](security.md#local-mode), the link alone binds: whoever holds it within its ten minutes approves the connection.

`list_connections` shows the connections of the org and whether each is `pending`, `connected`, `broken` or `removed`; Studio reads one with `get_connection`. `remove_connection` removes one for good: no playbook may use it any more, and Auto forgets its credential. The [MCP reference](../reference/mcp.md#connections) describes the three tools, and the [HTTP reference](../reference/http.md#connections) the routes, those of Studio's page among them.

## Which runtimes take connections

A person approves every connection, so a connection is added by a person, and a runtime takes connections only where a person reaches it as themselves:

| Runtime                                         | Who adds a connection                                                                                                                                                                                                      | The runtime the link names     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| One that signs people in, with `PUBLIC_URL` set | A person, through an agent signed in as them. `add_connection` refuses a key with `403`, since no person would approve what it adds                                                                                        | `PUBLIC_URL`                   |
| One in [local mode](security.md#local-mode)     | The local developer                                                                                                                                                                                                        | The runtime's loopback address |
| One of `API_KEYS` alone, which signs nobody in  | Nobody: `add_connection` refuses every connection with `403`, since no person could approve it. Set `PUBLIC_URL` to sign people in, or add the server to `auto-runtime.yaml` as [Add a tool server](tool-servers.md) shows |                                |

## What a connection holds

A connection has a name, which a function will give it as a tool server's name, a kind, an entry and a credential.

| Part         | What it holds                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | 1 to 32 lowercase letters, digits and hyphens, starting with a letter. It may not be the name of a tool server of the settings file, nor of another connection of the org that is not removed                                                                        |
| `kind`       | `mcp` for a remote MCP server, `openapi` for an HTTP API described by an OpenAPI document                                                                                                                                                                            |
| `entry`      | The server without its credential: `url` for `mcp`, or `document` and `base_url` for `openapi`, with `headers`, `query_params`, `allowed`, `playbooks`, `record_content` and `request_id` as an [entry of the settings file](configuration.md#tool-servers) has them |
| `credential` | How the server is credentialled, below, never its value: one object, its `kind` and the fields that kind takes                                                                                                                                                       |

Auto checks an entry as it checks an entry of the settings file, and refuses one that holds a value that looks like a credential, or a reference to an environment variable such as `${CRM_API_KEY}`. A connection's document is an `https` URL, or an `http` URL on a loopback address; it is never a file on Auto's disk.

## The kinds of credential

| Kind                 | What the person gives                                                                                                                                                                                                                                                                                       | Where the value is kept                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `none`               | Nothing; the server takes no credential                                                                                                                                                                                                                                                                     | Nowhere                                 |
| `reference`          | Nothing; `name` names an environment variable of Auto, such as `CRM_API_KEY`, that you set and list in the rule `variables`                                                                                                                                                                                 | In Auto's environment, where you put it |
| `secret`             | A key or token, on Studio's page. `name` and `in` say where it goes: `in: header` and the header's name, never one Auto sets itself such as `Content-Type`, `Host` or `Mcp-Session-Id`, or for an HTTP API `in: query` and a query parameter's name, or `in: security` and a scheme of its OpenAPI document | Sealed in Auto's secret store           |
| `client_credentials` | The client secret, or a private key with its algorithm, on Studio's page. `issuer`, `client_id` and `scope` name the authorization server and the client                                                                                                                                                    | Sealed in Auto's secret store           |
| `authorization`      | The consent flow, which a later release adds. Auto refuses it until then                                                                                                                                                                                                                                    |                                         |

Auto seals a secret under its secret key, `SECRETS_KEY` or the key file beside a SQLite ledger, as [the configuration reference](configuration.md#storage) sets out. No record of the org, no answer and no history holds the value, and the link's token is kept only as its SHA-256. Of a secret or a client secret of twelve characters or more, Auto keeps the last four beside the sealed value, and `list_connections` and `get_connection` show them in the credential's `ends_with`, so the person can tell which key a connection holds and whether a new one took; a private key, or a shorter value, shows none. Removing a connection forgets its secret.

A secret is only as recoverable as the key it was sealed under. When the key is lost, Auto can no longer read the credentials sealed under it, so their connections are broken. Once functions call through connections, Auto marks such a connection `broken` when it next needs the credential, with a sentence that says why; the person removes it and adds it again.

## Set the rules in `auto-runtime.yaml`

A `connections` section of `auto-runtime.yaml` says what people may add. Every rule has a default, so a file without the section lets people add any connection but one of the credential `reference`.

```yaml
connections:
  people_may_add: true
  allowed_hosts: ['*.example.com', 'crm.example.com']
  credential_kinds: [none, reference, secret, client_credentials]
  variables: [CRM_API_KEY]
```

| Rule               | What it does                                                                                                                                                                                                                                                                                                                                                                     | When left out                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `people_may_add`   | `false` refuses every connection: you set up every tool server yourself                                                                                                                                                                                                                                                                                                          | `true`                                |
| `allowed_hosts`    | The hosts a connection may reach. A pattern is a host, or `*.` and a host for every host under it, so `*.example.com` takes `crm.example.com` and not `example.com`. Auto checks the host of an `mcp` connection's `url`, of an `openapi` connection's `document` and `base_url`, and of the `issuer` of client credentials, where the client secret or the key's assertion goes | Every host                            |
| `credential_kinds` | The kinds of credential a connection may take, of the five above                                                                                                                                                                                                                                                                                                                 | Every kind                            |
| `variables`        | The environment variables a `reference` may name. A reference sends the value of a variable of Auto to the server the person names, so you list each one a connection may send; Auto refuses to start on a list that names a variable it reads for itself, such as `SECRETS_KEY`, `API_KEYS` or a provider's key                                                                 | None, so every `reference` is refused |

`add_connection` refuses a connection a rule does not take with `403`, saying which rule, such as `A connection may not reach the host api.billing.example.org on this runtime, which allows *.example.com and crm.example.com`. A rule the file gives that Auto cannot read stops it at start, naming the line. `CONNECTIONS`, the same rules as JSON, wins over the file. The [configuration reference](configuration.md#connections) lists the section.
