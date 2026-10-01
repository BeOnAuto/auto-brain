import { problemOf, problemResponse } from './problem.ts';

export function answerUnreadableRequest(): Response {
  return problemResponse(problemOf('malformed_request', 'The request could not be read'));
}
