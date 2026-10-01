export type ProblemReason =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'malformed_request'
  | 'unauthenticated'
  | 'origin_not_allowed'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'internal';

export interface ProblemIssue {
  readonly detail: string;
  readonly pointer: string;
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly reason: ProblemReason;
  readonly errors?: readonly ProblemIssue[];
  readonly incident?: string;
}

export type ProblemExtensions = Pick<Problem, 'errors' | 'incident'>;

interface ProblemType {
  readonly status: number;
  readonly title: string;
}

const problemTypes: Readonly<Record<ProblemReason, ProblemType>> = {
  invalid_input: { status: 422, title: 'Invalid input' },
  forbidden: { status: 403, title: 'Forbidden' },
  not_found: { status: 404, title: 'Not found' },
  conflict: { status: 409, title: 'Conflict' },
  unavailable: { status: 503, title: 'Unavailable' },
  malformed_request: { status: 400, title: 'Malformed request' },
  unauthenticated: { status: 401, title: 'Unauthenticated' },
  origin_not_allowed: { status: 403, title: 'Origin not allowed' },
  method_not_allowed: { status: 405, title: 'Method not allowed' },
  payload_too_large: { status: 413, title: 'Payload too large' },
  unsupported_media_type: { status: 415, title: 'Unsupported media type' },
  internal: { status: 500, title: 'Internal error' },
};

const problemMediaType = 'application/problem+json';

export function problemOf(reason: ProblemReason, detail: string, extensions: ProblemExtensions = {}): Problem {
  const { status, title } = problemTypes[reason];
  return { type: `https://on.auto/problems/${reason}`, title, status, detail, reason, ...extensions };
}

export function problemResponse(problem: Problem, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { 'content-type': problemMediaType, ...headers },
  });
}
