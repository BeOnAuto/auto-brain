import { Schema } from 'effect';

const serverFields = {
  name: Schema.String.annotate({
    description: 'The name of the server, which a function writes before the slash, as in graph/search or graph/*',
  }),
  type: Schema.Literals(['http', 'stdio']).annotate({
    description: 'http for a remote server, stdio for a process this server starts',
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
});

const AvailableServerSchema = Schema.Struct({
  ...serverFields,
  tools: Schema.Array(ServerToolSchema).annotate({
    description: 'The tools the server lists that the operator allows, in the order the server lists them',
  }),
});

const UnavailableServerSchema = Schema.Struct({
  ...serverFields,
  unavailable: Schema.String.annotate({
    description: 'Why the server could not be asked for its tools, in words',
  }),
  because: Schema.Literals(['failing', 'rate_limited', 'unreachable', 'key_refused']).annotate({
    description:
      'key_refused when the server did not accept the key this server gives it, which only whoever runs this server can put right; failing, rate_limited or unreachable when asking again later may work',
  }),
});

export const ToolServerSchema = Schema.Union([AvailableServerSchema, UnavailableServerSchema]).annotate({
  identifier: 'ToolServer',
  description: 'A tool server this brain may use, with its tools, or why they could not be listed',
});

export type ToolServer = typeof ToolServerSchema.Type;

export type ServerTool = typeof ServerToolSchema.Type;
