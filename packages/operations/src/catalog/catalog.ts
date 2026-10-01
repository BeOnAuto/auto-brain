import type { Scope } from '../caller/scope.ts';
import type { Registration } from '../definition/registration.ts';

interface Registered {
  readonly registration: Registration;
}

export interface Catalog {
  readonly operations: readonly Registration[];
  readonly operationsIn: <S extends Scope>(scope: S) => readonly Registration<S>[];
}

const prefixByScope: Readonly<Record<Scope, string>> = { org: '/orgs/{org}', brain: '/orgs/{org}/brains/{brain}' };

function routeOf({ scope, route }: Registration): string {
  return `${route.method} ${prefixByScope[scope]}${route.path}`;
}

function routeShapeOf(registration: Registration): string {
  return routeOf(registration).replaceAll(/\{[^}]*\}/gu, '{}');
}

function requireUniqueNames(registrations: readonly Registration[]): void {
  const names = registrations.map(({ name }) => name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new Error(`The operation name ${repeated} is used more than once`);
  }
}

function requireUniqueRoutes(registrations: readonly Registration[]): void {
  const operationByRouteShape = new Map<string, string>();
  for (const registration of registrations) {
    const shape = routeShapeOf(registration);
    const taken = operationByRouteShape.get(shape);
    if (taken !== undefined) {
      throw new Error(`The operations ${taken} and ${registration.name} share the route ${routeOf(registration)}`);
    }
    operationByRouteShape.set(shape, registration.name);
  }
}

export function makeCatalog(operations: readonly Registered[]): Catalog {
  const registrations = operations.map(({ registration }) => registration);
  requireUniqueNames(registrations);
  requireUniqueRoutes(registrations);
  const byScope: { readonly [S in Scope]: readonly Registration<S>[] } = {
    org: registrations.filter((registration) => registration.scope === 'org'),
    brain: registrations.filter((registration) => registration.scope === 'brain'),
  };
  return { operations: registrations, operationsIn: (scope) => byScope[scope] };
}
