import type { Catalog, OperationScope, Registration } from '@beonauto/operations';

export interface RouteEntry {
  readonly registration: Registration;
  readonly path: string;
}

interface Templated {
  readonly registration: Registration;
  readonly template: string;
}

const prefixes: Readonly<Record<OperationScope, string>> = {
  org: '/v1/orgs/{org}',
  brain: '/v1/orgs/{org}/brains/{brain}',
};

const parameter = /\{(\w+)\}/gu;

function templateOf(registration: Registration): Templated {
  return { registration, template: `${prefixes[registration.scope]}${registration.route.path}` };
}

function orderOf({ template }: Templated): string {
  return template
    .split('/')
    .map((segment) => (segment.startsWith('{') ? '1' : `0${segment}`))
    .join('/');
}

function literalsFirst(left: Templated, right: Templated): number {
  const [first, second] = [orderOf(left), orderOf(right)];
  return Number(first > second) - Number(first < second);
}

export function routeTableOf(catalog: Catalog): readonly RouteEntry[] {
  return catalog.operations
    .map(templateOf)
    .toSorted(literalsFirst)
    .map(({ registration, template }) => ({ registration, path: template.replaceAll(parameter, ':$1') }));
}
