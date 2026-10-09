import { Buffer } from 'node:buffer';

import { issuesDetail } from '@beonauto/definitions/json-schema';
import { answerDocument, isReadOnly, toolInWords, type AnsweredOnce, type CalledOnce } from '@beonauto/mcp';
import { capitalized, Conflict, Unavailable } from '@beonauto/operations';
import { measureOf, mostValueDepth } from '@beonauto/workflow-engine/dsl';
import { Effect, Result, Schema } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';
import { checkedAnswer } from '../requests/answer-check.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { valueAt } from '../tool-blocks/json-pointers.ts';

const isJson = Schema.is(Schema.Json);

interface CallFinished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

type Ending = Effect.Effect<CallFinished, Unavailable | Conflict>;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function recordOf({ call }: CallDocument): Schema.JsonObject {
  const { server, tool, read } = call;
  return read === undefined ? { server, tool } : { server, tool, read };
}

interface Reading {
  readonly named: string;
  readonly at: string;
}

function checkedValue(document: CallDocument, value: Schema.Json, { named, at }: Reading): Ending {
  const what = `What ${named} answered${at}`;
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > interactionBounds.answerBytes) {
    return unworkable(
      `${what} takes ${bytes} bytes as JSON, more than the ${interactionBounds.answerBytes} an answer may`,
    );
  }
  if (measureOf(value) === undefined) {
    return unworkable(`${what} nests deeper than the ${mostValueDepth} levels a value may`);
  }
  return Result.match(checkedAnswer(value, document.output.schema.document), {
    onSuccess: (output) => Effect.succeed({ output, record: recordOf(document) }),
    onFailure: (issues) => unworkable(`${what} does not match the output schema: ${issuesDetail(issues, 'answer')}`),
  });
}

function answeredWith(document: CallDocument, answer: Extract<AnsweredOnce, { readonly outcome: 'result' }>): Ending {
  const named = toolInWords(document.call);
  const read = document.call.read ?? '';
  const found = answerDocument(answer.answer);
  if (found === undefined) {
    return unworkable(
      `${capitalized(named)} answered neither structured content nor text, so there is nothing to read`,
    );
  }
  const value = valueAt(found, read);
  if (!isJson(value)) {
    return unworkable(
      typeof found === 'string'
        ? `${capitalized(named)} answered text that is not JSON, which holds nothing at ${read}`
        : `The answer of ${named} holds nothing at ${read}`,
    );
  }
  return checkedValue(document, value, { named, at: read === '' ? '' : ` at ${read}` });
}

function afterSending(called: AnsweredOnce, because: 'tool_error' | 'server_failed', detail: string): Ending {
  const ending = {
    detail,
    because,
    ...(called.retryAfterMs === null ? {} : { record: { retry_after_ms: called.retryAfterMs } }),
  };
  return Effect.fail(
    isReadOnly(called.annotations)
      ? new Unavailable({ ...ending, kind: 'tools_unfinished' })
      : new Conflict({ ...ending, kind: 'effect_unknown' }),
  );
}

function endedWith(document: CallDocument, called: AnsweredOnce): Ending {
  const named = toolInWords(document.call);
  if (called.outcome === 'result') {
    return answeredWith(document, called);
  }
  if (called.outcome === 'tool_error' && called.fields.result_bytes === null) {
    return unworkable(`${capitalized(named)} refused the arguments: ${called.detail}`);
  }
  return called.outcome === 'tool_error'
    ? afterSending(called, 'tool_error', `${capitalized(named)} answered an error: ${called.detail}`)
    : afterSending(
        called,
        'server_failed',
        `The MCP server ${document.call.server} failed: ${called.detail}, after the run called ${named}`,
      );
}

export function endingOf(document: CallDocument, called: CalledOnce): Ending {
  if (called.kind === 'unopened') {
    const { refused, because, detail } = called;
    return Effect.fail(new Unavailable({ detail, kind: refused, because }));
  }
  return endedWith(document, called);
}
