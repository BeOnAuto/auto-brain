import { describe, expect, it } from 'vitest';

import { primaryInstanceName, routeToContainer, type ContainerNamespace } from './router.ts';

describe('routeToContainer', () => {
  it('forwards the request to the primary container instance', async () => {
    const requestedNames: string[] = [];
    const forwarded: Request[] = [];
    const containers: ContainerNamespace = {
      getByName: (name) => {
        requestedNames.push(name);
        return {
          fetch: (request) => {
            forwarded.push(request);
            return Promise.resolve(new Response('from container'));
          },
        };
      },
    };
    const request = new Request('https://auto-brain.example/health');

    const response = await routeToContainer(request, containers);

    expect({ requestedNames, forwarded, body: await response.text() }).toEqual({
      requestedNames: [primaryInstanceName],
      forwarded: [request],
      body: 'from container',
    });
  });
});
