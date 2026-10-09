import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { RunEventSchema, type RunEvent } from '../runs/run-events.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(RunEventSchema));

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:01.000Z' };

const ofGreet = { definition_type: 'echo', name: 'greet', definition_version: 2 };

function recorded(event: RunEvent): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: runId,
    stream: `runs/${runId}`,
    version: 1,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: RunEvent) {
  return present(recorded(event)).at(0);
}

const shown = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
  causation_id: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
  at: '2026-10-01T09:00:01.000Z',
};

describe('the presenter of the events of a run', () => {
  it('presents a start with the definition that ran and the size of its input, at the time of the start', () => {
    expect(
      presented({
        type: 'run_started',
        definition_type: 'echo',
        name: 'greet',
        definition_version: 2,
        input: { who: 'Ada' },
        ...fact,
      }),
    ).toEqual({
      ...shown,
      type: 'run_started',
      summary: 'A run of the greeting “greet” started.',
      data: {
        run_id: runId,
        by: 'acme-admin',
        type: 'echo',
        name: 'greet',
        definition_version: 2,
        input_bytes: 13,
      },
    });
  });
});

describe('the presenter of work that finishes later', () => {
  it('presents nothing for it when its capability gives no words of it, so a history goes on from the start', () => {
    const deferred: RunEvent = { type: 'run_deferred', record: { run: 'r-1' }, ...ofGreet, ...fact };
    const runs = makeDefinitionPresenters([echo]).find(({ streamKind }) => streamKind === 'runs');

    expect([present(recorded(deferred)), runs?.present(recorded(deferred)), runs?.publicNames['run_deferred']]).toEqual(
      [[], [], ['run_deferred']],
    );
  });
});

describe('the presenter of the end of a run', () => {
  it('presents a success with the sizes of what it recorded', () => {
    expect(presented({ type: 'run_succeeded', output: 'Hello', record: {}, ...ofGreet, ...fact })).toEqual({
      ...shown,
      type: 'run_succeeded',
      summary: 'A run finished.',
      data: { run_id: runId, by: 'acme-admin', output_bytes: 7, record_bytes: 2 },
    });
  });

  it('presents a failure without blame', () => {
    expect(presented({ type: 'run_failed', ...ofGreet, ...fact })).toEqual({
      ...shown,
      type: 'run_failed',
      summary: 'A run broke down because of a problem inside the server.',
      data: { run_id: runId, by: 'acme-admin' },
    });
  });
});

describe('the presenter of a rejected run', () => {
  it('counts the issues of input it did not accept and shows the first five', () => {
    const issues = Array.from({ length: 6 }, (_, index) => ({ detail: `Issue ${index}`, pointer: `/field${index}` }));

    expect(
      presented({
        type: 'run_rejected',
        rejection: { reason: 'invalid_input', detail: 'Bad', issues },
        ...ofGreet,
        ...fact,
      }),
    ).toEqual({
      ...shown,
      type: 'run_rejected',
      summary: 'A run did not go through: what was given does not fit what it needs.',
      data: {
        run_id: runId,
        by: 'acme-admin',
        reason: 'invalid_input',
        detail: 'Bad',
        issue_count: 6,
        issues: issues.slice(0, 5),
      },
    });
  });
});

describe('the presenter of a run rejected for a conflict', () => {
  it('shows the kind of the conflict, when it was given', () => {
    const conflict = { reason: 'conflict', detail: 'The program raised an error on line 2: stop' } as const;

    expect([
      presented({ type: 'run_rejected', rejection: { ...conflict, kind: 'unworkable' }, ...ofGreet, ...fact }),
      presented({ type: 'run_rejected', rejection: conflict, ...ofGreet, ...fact }),
    ]).toMatchObject([
      {
        summary: 'A run did not go through: it cannot work as it is written.',
        data: { run_id: runId, by: 'acme-admin', ...conflict, kind: 'unworkable' },
      },
      { data: { run_id: runId, by: 'acme-admin', ...conflict } },
    ]);
  });
});

describe('the presenter of a run rejected for something it relies on', () => {
  it('shows the kind and the reason of something unavailable, when it was given, and the size of a record it kept', () => {
    const unavailable = { reason: 'unavailable', detail: 'No model' } as const;
    const record = { usage: { total: 320 }, duration_ms: 41 };

    expect([
      presented({
        type: 'run_rejected',
        rejection: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' },
        ...ofGreet,
        ...fact,
      }),
      presented({ type: 'run_rejected', rejection: unavailable, ...ofGreet, ...fact }),
      presented({ type: 'run_rejected', rejection: unavailable, record, ...ofGreet, ...fact }),
    ]).toMatchObject([
      {
        summary:
          'A run did not go through: this server does not offer the model named, because it is not among the models whoever runs the server allows.',
        data: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' },
      },
      {
        summary: 'A run did not go through: something the server relies on is not available right now.',
        data: { run_id: runId, by: 'acme-admin', ...unavailable },
      },
      { data: { run_id: runId, by: 'acme-admin', ...unavailable, record_bytes: 40 } },
    ]);
  });

  it('shows a definition that cannot run as written, and cuts a long detail and caller at a code point', () => {
    const conflict = presented({
      type: 'run_rejected',
      rejection: { reason: 'conflict', detail: '😀'.repeat(1000), kind: 'unworkable' },
      ...ofGreet,
      by: 'c'.repeat(300),
      at: fact.at,
    });

    expect(conflict).toMatchObject({
      summary: 'A run did not go through: it cannot work as it is written.',
      data: { reason: 'conflict', detail: '😀'.repeat(256), by: 'c'.repeat(256) },
    });
  });
});

const started = {
  type: 'tool_call_started',
  number: 3,
  call_id: 'toolu_03',
  server: 'graph',
  tool: 'get_lifelogs',
  arguments_bytes: 17,
  arguments_sha256: 'a'.repeat(64),
  ...fact,
} as const;

const answered = {
  type: 'tool_call_answered',
  number: 3,
  outcome: 'result',
  result_bytes: 42,
  result_sha256: 'b'.repeat(64),
  duration_ms: 120,
  jsonrpc_id: 7,
  ...fact,
} as const;

describe('the presenter of the start of a tool call', () => {
  it('presents a call by its number, server, tool and the size and digest of its arguments', () => {
    expect(presented(started)).toEqual({
      ...shown,
      type: 'tool_call_started',
      summary: 'A run made tool call 3, to the get lifelogs tool of graph.',
      data: {
        run_id: runId,
        by: 'acme-admin',
        number: 3,
        call_id: 'toolu_03',
        server: 'graph',
        tool: 'get_lifelogs',
        arguments_bytes: 17,
        arguments_sha256: 'a'.repeat(64),
      },
    });
  });

  it('keeps nothing of a name its server gave but letters and digits, so no slash or dot reaches the summary', () => {
    expect(presented({ ...started, tool: 'files/read.v2', server: 'graph-eu' })).toMatchObject({
      summary: 'A run made tool call 3, to the files read v2 tool of graph eu.',
    });
  });
});

describe('the presenter of the answer to a tool call', () => {
  it.each([
    ['result', 'Tool call 3 answered.'],
    ['tool_error', 'Tool call 3 answered with an error.'],
    ['server_failure', 'Tool call 3 failed at its server.'],
    ['timed_out', 'Tool call 3 took too long, so it was given up.'],
    ['cancelled', 'Tool call 3 was cancelled when the run ended.'],
  ] as const)('presents an answer with the outcome %s in plain words', (outcome, summary) => {
    expect(presented({ ...answered, outcome })).toMatchObject({ type: 'tool_call_answered', summary });
  });

  it('presents an answer with the size, digest and duration of its result and the ids that name it', () => {
    expect(presented({ ...answered, server_request_id: 'req-9' })).toEqual({
      ...shown,
      type: 'tool_call_answered',
      summary: 'Tool call 3 answered.',
      data: {
        run_id: runId,
        by: 'acme-admin',
        number: 3,
        outcome: 'result',
        result_bytes: 42,
        result_sha256: 'b'.repeat(64),
        duration_ms: 120,
        jsonrpc_id: 7,
        server_request_id: 'req-9',
      },
    });
  });

  it('presents an answer the server gave no content or id for', () => {
    expect(
      presented({
        ...answered,
        outcome: 'server_failure',
        result_bytes: null,
        result_sha256: null,
        jsonrpc_id: 'j-1',
        server_request_id: null,
      }),
    ).toMatchObject({
      data: { result_bytes: null, result_sha256: null, jsonrpc_id: 'j-1', server_request_id: null },
    });
  });
});

describe('the presenter of the content of a tool call', () => {
  it('shows recorded content cut to 2 KiB at a code point', () => {
    const content = JSON.stringify({ text: '😀'.repeat(2000) });

    expect([
      presented({ ...started, arguments_json: content }),
      presented({ ...answered, result_json: '{"rows":[]}' }),
    ]).toMatchObject([
      { data: { arguments_json: content.slice(0, 9 + 2 * 509) } },
      { data: { result_json: '{"rows":[]}' } },
    ]);
  });
});
