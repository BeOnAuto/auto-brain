import type { OperationScope } from '../caller/operation-scope.ts';
import type { RouteRegistration } from '../definition/registration.ts';

interface Registered {
  readonly registration: RouteRegistration;
}

export interface Catalog {
  readonly operations: readonly RouteRegistration[];
  readonly operationsIn: <S extends OperationScope>(scope: S) => readonly RouteRegistration<S>[];
}

const prefixByScope: Readonly<Record<OperationScope, string>> = {
  org: '/orgs/{org}',
  brain: '/orgs/{org}/brains/{brain}',
};

function routeOf({ scope, route }: RouteRegistration): string {
  return `${route.method} ${prefixByScope[scope]}${route.path}`;
}

function routeShapeOf(registration: RouteRegistration): string {
  return routeOf(registration)
    .split('/')
    .map((segment) => (segment.startsWith('{') ? '{}' : segment))
    .join('/');
}

function scopedNameOf({ scope, name }: RouteRegistration): string {
  return `${scope}:${name}`;
}

function requireUniqueNames(registrations: readonly RouteRegistration[]): void {
  const scopedNames = registrations.map((registration) => scopedNameOf(registration));
  const repeated = registrations.find(
    (registration, index) => scopedNames.indexOf(scopedNameOf(registration)) !== index,
  );
  if (repeated !== undefined) {
    throw new Error(`The operation name ${repeated.name} is used more than once`);
  }
}

function twinProblem(org: RouteRegistration, brain: RouteRegistration): string | undefined {
  if (!org.targetsBrain) {
    return 'so the org operation must take the brain it answers for';
  }
  return org.kind === brain.kind ? undefined : `so both must be of one kind, and the org one is a ${org.kind}`;
}

function requireTwinsAlike(registrations: readonly RouteRegistration[]): void {
  const brainOperations = new Map(
    registrations.filter(({ scope }) => scope === 'brain').map((registration) => [registration.name, registration]),
  );
  for (const org of registrations.filter(({ scope }) => scope === 'org')) {
    const brain = brainOperations.get(org.name);
    const problem = brain === undefined ? undefined : twinProblem(org, brain);
    if (problem !== undefined) {
      throw new Error(`The operation name ${org.name} is used at both scopes, ${problem}`);
    }
  }
}

function requireUniqueRoutes(registrations: readonly RouteRegistration[]): void {
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
  requireTwinsAlike(registrations);
  requireUniqueRoutes(registrations);
  const byScope: { readonly [S in OperationScope]: readonly RouteRegistration<S>[] } = {
    org: registrations.filter((registration) => registration.scope === 'org'),
    brain: registrations.filter((registration) => registration.scope === 'brain'),
  };
  return { operations: registrations, operationsIn: (scope) => byScope[scope] };
}
