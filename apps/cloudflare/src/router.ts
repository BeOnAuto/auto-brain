interface ContainerStub {
  fetch(request: Request): Promise<Response>;
}

export interface ContainerNamespace {
  getByName(name: string): ContainerStub;
}

export const primaryInstanceName = 'primary';

export function routeToContainer(request: Request, containers: ContainerNamespace): Promise<Response> {
  return containers.getByName(primaryInstanceName).fetch(request);
}
