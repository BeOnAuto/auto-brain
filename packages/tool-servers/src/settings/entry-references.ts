import {
  misplacedReferences as misplacedIn,
  secretsOfEntry as secretsIn,
  type Reference,
  type ReferencePlacement,
  type SettingProblem,
} from '@on.auto/config';
import { JsonPointer, Redacted } from 'effect';

import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';

const misplaced =
  'Holds a reference to an environment variable, which only headers, query_params, security, env and auth may hold: an argument shows in the listing of the processes of the machine, and the URL of a server or of a document is no place for a credential';

function placementOf(entry: string): ReferencePlacement {
  return {
    setting: toolServersSetting,
    entry,
    fields: ['headers', 'query_params', 'security', 'env', 'auth'],
    misplaced,
  };
}

export function misplacedReferences(entry: string, references: readonly Reference[]): readonly SettingProblem[] {
  return misplacedIn(placementOf(entry), references);
}

export function unreferencedSecurity(
  entry: string,
  written: ServerEntryFields,
  references: readonly Reference[],
): readonly string[] {
  const pointers = new Set(references.map(({ pointer }) => pointer));
  return Object.keys(written.security ?? {})
    .map((scheme) => `/${JsonPointer.escapeToken(entry)}/security/${JsonPointer.escapeToken(scheme)}`)
    .filter((pointer) => !pointers.has(pointer));
}

export function secretsOfEntry(
  entry: string,
  fields: ServerEntryFields,
  references: readonly Reference[],
): readonly Redacted.Redacted[] {
  const wholeValues = Object.values(fields.security ?? {}).map((value) => Redacted.make(value));
  return [...secretsIn(placementOf(entry), references), ...wholeValues];
}
