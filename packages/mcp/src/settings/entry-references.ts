import type { Reference } from '@beonauto/config';
import { Redacted } from 'effect';

import { mcpServersSetting } from './entry-checks.ts';
import { problem } from './json-setting.ts';
import type { SettingProblem } from './mcp-settings.ts';

const fieldsHoldingSecrets = ['headers', 'env', 'auth'] as const;

const misplaced =
  'Holds a reference to an environment variable, which only headers, env and auth may hold: an argument shows in the listing of the processes of the machine, and a URL is not a header';

function holdsSecrets(entry: string, { pointer }: Reference): boolean {
  return fieldsHoldingSecrets.some((field) => pointer.startsWith(`${entry}/${field}/`));
}

export function misplacedReferences(entry: string, references: readonly Reference[]): readonly SettingProblem[] {
  return references
    .filter((reference) => !holdsSecrets(entry, reference))
    .map(({ pointer }) => problem(mcpServersSetting, pointer, misplaced));
}

export function secretsOfEntry(entry: string, references: readonly Reference[]): readonly Redacted.Redacted[] {
  return references
    .filter((reference) => holdsSecrets(entry, reference))
    .flatMap(({ value }) => (value === null ? [] : [Redacted.make(value)]));
}
