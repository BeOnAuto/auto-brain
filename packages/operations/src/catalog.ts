import type { Registration } from './registration.ts';
import type { Scope } from './scope.ts';

interface Registered {
  readonly registration: Registration;
}

export interface Catalog {
  readonly operations: readonly Registration[];
  readonly operationsIn: <S extends Scope>(scope: S) => readonly Registration<S>[];
}

export function makeCatalog(operations: readonly Registered[]): Catalog {
  const registrations = operations.map(({ registration }) => registration);
  const names = registrations.map(({ name }) => name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new Error(`The operation name ${repeated} is used more than once`);
  }
  const byScope: { readonly [S in Scope]: readonly Registration<S>[] } = {
    org: registrations.filter((registration) => registration.scope === 'org'),
    brain: registrations.filter((registration) => registration.scope === 'brain'),
  };
  return { operations: registrations, operationsIn: (scope) => byScope[scope] };
}
