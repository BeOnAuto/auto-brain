import { routeToContainer, type ContainerNamespace } from './router.ts';

export { BrainContainer } from './brain-container.ts';

interface Env {
  readonly BRAIN: ContainerNamespace;
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => routeToContainer(request, env.BRAIN),
};
