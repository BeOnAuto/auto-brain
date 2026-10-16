import { Effect } from 'effect';

import { notebookOperations, waitForever } from './notebook.ts';

export function waitForeverAnnouncing(announce: () => void): typeof waitForever {
  const { registration } = waitForever;
  return {
    ...waitForever,
    registration: {
      ...registration,
      run: (input, encoding) => Effect.andThen(Effect.sync(announce), registration.run(input, encoding)),
    },
  };
}

export function notebookOperationsAnnouncingWaits(announce: () => void) {
  const announcing = waitForeverAnnouncing(announce);
  return notebookOperations.map((operation) => (operation === waitForever ? announcing : operation));
}
