import { Schema } from 'effect';

export const channelsSetting = 'CHANNELS';

const ScopeFields = {
  org: Schema.optionalKey(
    Schema.String.annotate({ description: 'The org whose functions may use the channel, required' }),
  ),
  brains: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: 'The brains of that org that may use it; every brain of the org when left out',
    }),
  ),
};

const ToField = Schema.String.annotate({
  description:
    'A regular expression the whole of the party a request is rendered to must match, so a brain addresses no one the operator did not allow',
});

export const WebhookEntrySchema = Schema.Struct({
  type: Schema.Literal('webhook').annotate({ description: 'webhook: an HTTP POST of the request, signed' }),
  url: Schema.String.annotate({ description: 'The https URL the request is posted to, or http on a loopback address' }),
  headers: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description:
        'Headers sent with every delivery, their values treated as secrets: in the configuration file a credential is a reference such as ${PARTNER_API_KEY}',
    }),
  ),
  secret: Schema.String.annotate({
    description:
      'The Standard Webhooks secret every delivery is signed with, whsec_ and a key of 24 to 64 bytes in base64, as a reference such as ${PARTNER_WEBHOOK_SECRET}',
  }),
  to: ToField,
  answers: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true when the receiver may answer within the delivery, with a 200 whose body is the answer; false when left out',
    }),
  ),
  ...ScopeFields,
});

export const McpEntrySchema = Schema.Struct({
  type: Schema.Literal('mcp').annotate({ description: 'mcp: one call of a tool of a configured MCP server' }),
  server: Schema.String.annotate({ description: 'The MCP server of mcp_servers whose tool delivers the request' }),
  tool: Schema.String.annotate({ description: "The tool of that server, which the server's allowed must name" }),
  with: Schema.Record(Schema.String, Schema.String).annotate({
    description:
      'The arguments of the call, each a Liquid template over to, message, run_id, function, expires_at and answer_schema; | json for a structured value',
  }),
  to: ToField,
  ...ScopeFields,
});

export type WebhookEntry = typeof WebhookEntrySchema.Type;

export type McpEntry = typeof McpEntrySchema.Type;

export type ChannelEntry = WebhookEntry | McpEntry;

export const ChannelsSchema = Schema.Record(Schema.String, Schema.Union([WebhookEntrySchema, McpEntrySchema]));
