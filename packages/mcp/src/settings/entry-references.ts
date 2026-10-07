import {
  misplacedReferences as misplacedIn,
  secretsOfEntry as secretsIn,
  type Reference,
  type ReferencePlacement,
  type SettingProblem,
} from '@beonauto/config';
import type { Redacted } from 'effect';

import { mcpServersSetting } from './entry-checks.ts';

const misplaced =
  'Holds a reference to an environment variable, which only headers, env and auth may hold: an argument shows in the listing of the processes of the machine, and a URL is not a header';

function placementOf(entry: string): ReferencePlacement {
  return { setting: mcpServersSetting, entry, fields: ['headers', 'env', 'auth'], misplaced };
}

export function misplacedReferences(entry: string, references: readonly Reference[]): readonly SettingProblem[] {
  return misplacedIn(placementOf(entry), references);
}

export function secretsOfEntry(entry: string, references: readonly Reference[]): readonly Redacted.Redacted[] {
  return secretsIn(placementOf(entry), references);
}
