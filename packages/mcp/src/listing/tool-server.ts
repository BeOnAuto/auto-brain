import { Schema } from 'effect';

import { ToolAnnotationsSchema } from '../bounds/tool-results.ts';

const serverFields = {
  name: Schema.String.annotate({
    description: 'The name of the server, which a function writes before the slash, as in graph/search or graph/*',
  }),
  type: Schema.Literals(['http', 'stdio']).annotate({
    description: 'http for a remote server, stdio for a process this server starts',
  }),
  record_content: Schema.Boolean.annotate({
    description:
      "Whether the arguments and the answers of the server's calls are kept whole in the brain's ledger, where anyone who may read the brain reads them; false only when whoever runs this server set record_content: false on its entry",
  }),
};

const ServerToolSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name of the tool, which a function writes after the slash' }),
  description: Schema.String.annotate({
    description: 'What the tool does, as its server describes it, cut to 4 KiB; empty when it gives none',
  }),
  input_schema: Schema.JsonObject.annotate({
    description: 'The JSON Schema of the arguments the tool takes, as its server gives it',
  }),
  annotations: Schema.optionalKey(
    ToolAnnotationsSchema.annotate({
      description:
        'The hints its server gives the tool, readOnlyHint, destructiveHint, idempotentHint and openWorldHint, as it gives them; absent when it gives none',
    }),
  ),
  testable: Schema.Boolean.annotate({
    description:
      'true when test_tool_call may test the tool: its server marks it read-only, or whoever runs this server lists it as safe to test',
  }),
});

const availableFields = {
  tools: Schema.Array(ServerToolSchema).annotate({
    description: 'The tools the server lists that the operator allows, in the order the server lists them',
  }),
};

const unavailableFields = {
  unavailable: Schema.String.annotate({
    description: 'Why the server could not be asked for its tools, in words',
  }),
  because: Schema.Literals(['failing', 'rate_limited', 'unreachable', 'key_refused']).annotate({
    description:
      'key_refused when the server did not accept the key this server gives it, which only whoever runs this server can put right; failing, rate_limited or unreachable when asking again later may work',
  }),
};

const servedBrainsFields = {
  brains: Schema.Array(Schema.String).annotate({
    description: "The brains of the org whose functions may use the server, or ['*'] for every brain of the org",
  }),
};

export const ToolServerSchema = Schema.Union([
  Schema.Struct({ ...serverFields, ...availableFields }),
  Schema.Struct({ ...serverFields, ...unavailableFields }),
]).annotate({
  identifier: 'ToolServer',
  description: 'A tool server this brain may use, with its tools, or why they could not be listed',
});

export const OrgToolServerSchema = Schema.Union([
  Schema.Struct({ ...serverFields, ...servedBrainsFields, ...availableFields }),
  Schema.Struct({ ...serverFields, ...servedBrainsFields, ...unavailableFields }),
]).annotate({
  identifier: 'OrgToolServer',
  description: 'A tool server of the org, with the brains it serves and its tools, or why they could not be listed',
});

export type ToolServer = typeof ToolServerSchema.Type;

export type OrgToolServer = typeof OrgToolServerSchema.Type;

export type ServerTool = typeof ServerToolSchema.Type;
