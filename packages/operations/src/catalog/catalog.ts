import type { OperationScope } from '../caller/operation-scope.ts';
import type { Registration } from '../definition/registration.ts';

interface Registered {
  readonly registration: Registration;
}

export interface Catalog {
  readonly operations: readonly Registration[];
  readonly operationsIn: <S extends OperationScope>(scope: S) => readonly Registration<S>[];
}

const prefixByScope: Readonly<Record<OperationScope, string>> = {
  org: '/orgs/{org}',
  brain: '/orgs/{org}/brains/{brain}',
};

function routeOf({ scope, route }: Registration): string {
  return `${route.method} ${prefixByScope[scope]}${route.path}`;
}

function routeShapeOf(registration: Registration): string {
  return routeOf(registration)
    .split('/')
    .map((segment) => (segment.startsWith('{') ? '{}' : segment))
    .join('/');
}

function scopedNameOf({ scope, name }: Registration): string {
  return `${scope}:${name}`;
}

function requireUniqueNames(registrations: readonly Registration[]): void {
  const scopedNames = registrations.map((registration) => scopedNameOf(registration));
  const repeated = registrations.find(
    (registration, index) => scopedNames.indexOf(scopedNameOf(registration)) !== index,
  );
  if (repeated !== undefined) {
    throw new Error(`The operation name ${repeated.name} is used more than once`);
  }
}

function requireBrainOfTwins(registrations: readonly Registration[]): void {
  const brainNames = new Set(registrations.filter(({ scope }) => scope === 'brain').map(({ name }) => name));
  const twin = registrations.find(
    ({ scope, name, targetsBrain }) => scope === 'org' && brainNames.has(name) && !targetsBrain,
  );
  if (twin !== undefined) {
    throw new Error(
      `The operation name ${twin.name} is used at both scopes, so the org operation must take the brain it answers for`,
    );
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
  requireBrainOfTwins(registrations);
  requireUniqueRoutes(registrations);
  const byScope: { readonly [S in OperationScope]: readonly Registration<S>[] } = {
    org: registrations.filter((registration) => registration.scope === 'org'),
    brain: registrations.filter((registration) => registration.scope === 'brain'),
  };
  return { operations: registrations, operationsIn: (scope) => byScope[scope] };
}
