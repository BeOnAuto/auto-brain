import { writeFileSync } from 'node:fs';

import { Schema } from 'effect';

export const callInFlightFileVariable = 'CALL_IN_FLIGHT_FILE';

const decodeFile = Schema.decodeUnknownSync(Schema.NonEmptyString);

export function callInFlightAnnouncedIn(environment: Readonly<Record<string, string | undefined>>): () => void {
  return () => {
    writeFileSync(decodeFile(environment[callInFlightFileVariable]), '');
  };
}
