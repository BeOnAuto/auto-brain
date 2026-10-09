import { Schema } from 'effect';

export const mcpServersSetting = 'MCP_SERVERS';

const secretValues =
  'their values treated as secrets: in the configuration file a credential is a reference such as ${GRAPH_API_KEY}';

const AuthSchema = Schema.Struct({
  issuer: Schema.String.annotate({
    description:
      'The issuer of the authorization server the credential was registered with, pinned: it is sent to no other. An https URL',
  }),
  client_id: Schema.String.annotate({ description: 'The client id registered with that authorization server' }),
  client_secret: Schema.optionalKey(
    Schema.String.annotate({ description: 'The client secret, as a reference such as ${GRAPH_CLIENT_SECRET}' }),
  ),
  private_key: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A private key in PEM that signs the client assertion, as a reference such as ${GRAPH_PRIVATE_KEY}',
    }),
  ),
  algorithm: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
  scope: Schema.optionalKey(Schema.String.annotate({ description: 'The scopes to ask for, separated by spaces' })),
}).annotate({
  description:
    'OAuth client credentials, for a server whose authorization server issues tokens to clients: client_secret, or private_key with its algorithm',
});

export const McpServerEntrySchema = Schema.Struct({
  type: Schema.optionalKey(
    Schema.Literals(['http', 'stdio']).annotate({
      description:
        'http for a remote server, given url; stdio for a process, given command. Taken from url or command when left out',
    }),
  ),
  url: Schema.optionalKey(
    Schema.String.annotate({ description: 'The http or https URL of a remote server, spoken to over Streamable HTTP' }),
  ),
  headers: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `Headers sent to a remote server with every request, ${secretValues}`,
    }),
  ),
  auth: Schema.optionalKey(AuthSchema),
  command: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The command of a stdio server: an installed, pinned program, never a package downloaded at start such as npx -y',
    }),
  ),
  args: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({ description: 'The arguments of the command of a stdio server' }),
  ),
  env: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `The whole environment of the process of a stdio server, which inherits nothing else, ${secretValues}`,
    }),
  ),
  org: Schema.optionalKey(Schema.String.annotate({ description: 'The org this server serves, required' })),
  brains: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'The brains of the org this server serves; every brain of the org when left out',
    }),
  ),
  allowed: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The tools of this server a reasoning function may name and a channel may call, each named as the server lists it; every tool of the server when left out',
    }),
  ),
  testable: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The tools of this server test_tool_call may test although the server does not mark them read-only, each named as the server lists it and among allowed; only the tools the server marks read-only when left out',
    }),
  ),
  record_content: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true to record the arguments and results of calls, cut to 4 KiB, on the run that made them, where anyone who may read the brain reads them. Default false',
    }),
  ),
  request_id: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The response header, or the key of the metadata of a result, in which the server carries its own id of a request, recorded with each call',
    }),
  ),
});

export type McpServerEntryFields = typeof McpServerEntrySchema.Type;

export const McpServersSchema = Schema.Record(
  Schema.String.annotate({
    description:
      'The name a reasoning function gives the server in server/tool: 1 to 32 lowercase letters, digits and hyphens, starting with a letter, and not the name of a model provider or gateway',
  }),
  McpServerEntrySchema,
);
