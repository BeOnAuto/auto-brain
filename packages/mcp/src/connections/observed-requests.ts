import { Option, Schema } from 'effect';

import { ignored } from './ignored.ts';

type RequestId = string | number;

type Marker = (resumptionToken: string) => void;

interface ObservedResponse {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly serverRequestId: string | null;
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
  readonly noteAnswered: (body: unknown, response: Readonly<Response>) => void;
  readonly take: (marker: Marker) => Observed;
  readonly lastRetryAfterMs: () => number | null;
}

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

export function observations(requestId: string | null): Observations {
  const requestIdHeader = requestId !== null && headerName.test(requestId) ? requestId : null;
  const sent = new Map<Marker, RequestId>();
  const answered = new Map<RequestId, ObservedResponse | null>();
  const latest: { retryAfterMs: number | null } = { retryAfterMs: null };
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
      const observed: ObservedResponse = {
        status: response.status,
        retryAfterMs: retryAfterMsOf(response.headers.get('retry-after'), Date.now()),
        serverRequestId: requestIdHeader === null ? null : response.headers.get(requestIdHeader),
      };
      latest.retryAfterMs = observed.retryAfterMs;
      const id = idIn(body);
      if (id !== undefined && answered.has(id)) {
        answered.set(id, observed);
      }
    },
    take: (marker) => {
      const id = sent.get(marker);
      sent.delete(marker);
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
