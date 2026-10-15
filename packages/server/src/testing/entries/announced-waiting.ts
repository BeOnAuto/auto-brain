import { writeFileSync } from 'node:fs';

import { waitForever } from '@on.auto/api/testing';
import { Effect, Schema } from 'effect';

export const callInFlightFileVariable = 'CALL_IN_FLIGHT_FILE';

const decodeFile = Schema.decodeUnknownSync(Schema.NonEmptyString);

export function waitForeverAnnouncedIn(environment: Readonly<Record<string, string | undefined>>): typeof waitForever {
  const file = decodeFile(environment[callInFlightFileVariable]);
  const { registration } = waitForever;
  return {
    ...waitForever,
    registration: {
      ...registration,
      run: (input, encoding) =>
        Effect.andThen(
          Effect.sync(() => {
            writeFileSync(file, '');
          }),
          registration.run(input, encoding),
        ),
    },
  };
}
