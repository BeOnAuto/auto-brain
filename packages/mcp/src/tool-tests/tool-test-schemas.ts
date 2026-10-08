import { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { serverNamePattern, toolNamePattern } from '../names/tool-reference.ts';

function argumentsWithinTheirBound(value: Schema.JsonObject): true | string {
  const bytes = bytesOf(JSON.stringify(value));
  return bytes <= toolBounds.argumentBytes
    ? true
    : `The arguments take ${bytes} bytes as JSON, more than the ${toolBounds.argumentBytes} a call may send`;
}

export const TestToolCallInputSchema = Schema.Struct({
  server: Schema.String.annotate({
    description: 'The tool server, as list_tool_servers names it and a function writes it before the slash',
  }).check(Schema.isPattern(serverNamePattern)),
  tool: Schema.String.annotate({
    description: 'The tool of that server, as list_tool_servers lists it and a function writes it after the slash',
  }).check(Schema.isPattern(toolNamePattern)),
  arguments: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description:
        "The arguments of the call, an object in the shape of the tool's input_schema; {} when left out, at most 16 KiB as JSON",
    }).check(Schema.makeFilter(argumentsWithinTheirBound)),
  ),
});

export const TestedOutcomeSchema = Schema.Literals(['result', 'tool_error', 'server_failure', 'timed_out']);

export const ToolTestedSchema = Schema.Struct({
  test_id: Schema.String.annotate({
    description: 'The id of the test, a UUID, under which its two events are recorded',
  }),
  server: Schema.String.annotate({ description: 'The tool server, as given' }),
  tool: Schema.String.annotate({ description: 'The tool, as given' }),
  outcome: TestedOutcomeSchema.annotate({
    description:
      "result when the tool answered; tool_error when it answered an error or refused the arguments, which a run's model may recover from; server_failure when its server failed on the call; timed_out when it did not answer in time",
  }),
  text: Schema.String.annotate({
    description:
      "What a reasoning function's model would see of the answer, scrubbed of the server's secrets and cut at 64 KiB with the note a run adds; for a failure, the words a run's model gets",
  }),
  result_bytes: Schema.NullOr(Schema.Int).annotate({
    description: 'The size of the whole result as its server gave it, before the cut; null when there is none',
  }),
  duration_ms: Schema.Int.annotate({ description: 'How long the call took, in milliseconds' }),
  server_request_id: Schema.optionalKey(
    Schema.String.annotate({
      description: "The server's own id of the request, where whoever runs this server says where it carries one",
    }),
  ),
  tested_at: Schema.String.annotate({ description: 'When the call was made, in ISO 8601 UTC' }),
});
