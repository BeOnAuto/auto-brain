import type { Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { cutAsStored } from '../bounds/text-bytes.ts';
import { answeredInWords, inWords } from '../names/tool-words.ts';
import {
  ToolTestEventSchema,
  toolTestsKind,
  type ToolTestAnswered,
  type ToolTestEvent,
  type ToolTestStarted,
} from './tool-test-events.ts';

const mostNameBytes = 256;

const mostDigestBytes = 128;

const decodeToolTestEvent = Schema.decodeUnknownSync(Schema.toCodecJson(ToolTestEventSchema));

function contentShown(name: string, content: string | undefined) {
  return content === undefined ? {} : { [name]: cutAsStored(content, toolBounds.shownContentBytes) };
}

function startedAccount(event: ToolTestStarted) {
  const server = cutAsStored(event.server, mostNameBytes);
  const tool = cutAsStored(event.tool, mostNameBytes);
  return {
    summary: `Someone allowed to change the brain tested the ${inWords(tool)} tool of ${inWords(server)}.`,
    data: {
      test_id: event.test_id,
      by: cutAsStored(event.by, mostNameBytes),
      server,
      tool,
      arguments_bytes: event.arguments_bytes,
      arguments_sha256: cutAsStored(event.arguments_sha256, mostDigestBytes),
      ...contentShown('arguments_json', event.arguments_json),
    },
  };
}

function idShown(id: string | number | null): string | number | null {
  return typeof id === 'string' ? cutAsStored(id, mostDigestBytes) : id;
}

function serverRequestShown(id: string | null | undefined) {
  return id === undefined ? {} : { server_request_id: id === null ? null : cutAsStored(id, mostNameBytes) };
}

function answeredAccount(event: ToolTestAnswered) {
  return {
    summary: `The tested tool ${answeredInWords[event.outcome]}.`,
    data: {
      test_id: event.test_id,
      by: cutAsStored(event.by, mostNameBytes),
      outcome: event.outcome,
      result_bytes: event.result_bytes,
      result_sha256: event.result_sha256 === null ? null : cutAsStored(event.result_sha256, mostDigestBytes),
      duration_ms: event.duration_ms,
      jsonrpc_id: idShown(event.jsonrpc_id),
      ...serverRequestShown(event.server_request_id),
      ...contentShown('result_json', event.result_json),
    },
  };
}

function accountOf(event: ToolTestEvent) {
  return event.type === 'tool_test_started' ? startedAccount(event) : answeredAccount(event);
}

export const toolTestPresenter: Presenter = {
  streamKind: toolTestsKind,
  publicNames: { tool_test_started: ['tool_test_started'], tool_test_answered: ['tool_test_answered'] },
  present: ({ id, cursor, causationId, data }) => {
    const event = decodeToolTestEvent(data);
    return [{ id, cursor, causation_id: causationId, at: event.at, type: event.type, ...accountOf(event) }];
  },
};
