import { Option, Schema } from 'effect';

import { ignored } from './ignored.ts';

type RequestId = string | number;

type Marker = (resumptionToken: string) => void;

interface ObservedResponse {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly serverRequestId: string | null;
  readonly tooLarge: boolean;
}

export interface SendOptions {
  readonly onresumptiontoken?: ((token: string) => void) | undefined;
}

export interface Observed {
  readonly id: RequestId | null;
  readonly response: ObservedResponse | null;
}

export interface Observations {
  readonly mark: () => Marker;
  readonly noteSent: (message: unknown, options: Readonly<SendOptions> | undefined) => void;
  readonly noteAnswered: (body: unknown, response: Readonly<Response>) => Response;
  readonly whenTooLarge: (marker: Marker, stop: () => void) => void;
  readonly take: (marker: Marker) => Observed;
  readonly lastRetryAfterMs: () => number | null;
}

export class AnswerTooLarge extends Error {}

type Counting = (response: Readonly<Response>, mostBytes: number, tooLarge: () => void) => Response;

const counted: Counting = (response, mostBytes, tooLarge) => {
  if (response.body === null) {
    return response;
  }
  let read = 0;
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk: Readonly<Uint8Array>, controller: Readonly<TransformStreamDefaultController<Uint8Array>>) => {
      read += chunk.byteLength;
      if (read > mostBytes) {
        tooLarge();
        controller.error(
          new AnswerTooLarge(`The MCP server answered more than the ${mostBytes} bytes a call may take`),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(counting), response);
};

const MessageSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optionalKey(Schema.String),
});

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(MessageSchema));

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const decodeMessage = Schema.decodeUnknownOption(MessageSchema);

function idIn(body: unknown): RequestId | undefined {
  return typeof body === 'string' ? decodeBody(body).id : undefined;
}

function requestIdOf(message: unknown): RequestId | undefined {
  const decoded = Option.getOrUndefined(decodeMessage(message));
  return decoded?.method === undefined ? undefined : decoded.id;
}

export function retryAfterMsOf(value: string | null, now: number): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

type Observing = (response: Readonly<Response>, requestIdHeader: string | null) => ObservedResponse;

const observedOf: Observing = (response, requestIdHeader) => ({
  status: response.status,
  retryAfterMs: retryAfterMsOf(response.headers.get('retry-after'), Date.now()),
  serverRequestId: requestIdHeader === null ? null : response.headers.get(requestIdHeader),
  tooLarge: false,
});

export function observations(requestId: string | null, mostAnswerBytes: number): Observations {
  const requestIdHeader = requestId !== null && headerName.test(requestId) ? requestId : null;
  const sent = new Map<Marker, RequestId>();
  const answered = new Map<RequestId, ObservedResponse | null>();
  const stops = new Map<Marker, () => void>();
  const latest: { retryAfterMs: number | null } = { retryAfterMs: null };
  const stopOf = (id: RequestId): (() => void) | undefined =>
    [...sent]
      .flatMap(([marker, sentId]: readonly [Marker, RequestId]) => (sentId === id ? [stops.get(marker)] : []))
      .at(0);
  return {
    mark: () => ignored.bind(null),
    noteSent: (message, options) => {
      const marker = options?.onresumptiontoken;
      const id = requestIdOf(message);
      if (marker !== undefined && id !== undefined) {
        sent.set(marker, id);
        answered.set(id, null);
      }
    },
    noteAnswered: (body, response) => {
      const observed = observedOf(response, requestIdHeader);
      latest.retryAfterMs = observed.retryAfterMs;
      const id = idIn(body);
      if (id === undefined || !answered.has(id)) {
        return counted(response, mostAnswerBytes, ignored);
      }
      answered.set(id, observed);
      return counted(response, mostAnswerBytes, () => {
        answered.set(id, { ...observed, tooLarge: true });
        stopOf(id)?.();
      });
    },
    whenTooLarge: (marker, stop) => {
      stops.set(marker, stop);
    },
    take: (marker) => {
      const id = sent.get(marker);
      sent.delete(marker);
      stops.delete(marker);
      if (id === undefined) {
        return { id: null, response: null };
      }
      const response = answered.get(id) ?? null;
      answered.delete(id);
      return { id, response };
    },
    lastRetryAfterMs: () => latest.retryAfterMs,
  };
}
