import { describe, expect, it, vi } from 'vitest';

import worker, { BrainContainer } from './index.ts';

vi.mock('@cloudflare/containers', () => ({ Container: Object }));

function construct(Target: new (...args: never[]) => BrainContainer): BrainContainer {
  return new Target();
}

describe('worker', () => {
  it('serves every request from the container', async () => {
    const env = {
      BRAIN: { getByName: () => ({ fetch: () => Promise.resolve(new Response('ok')) }) },
    };

    const response = await worker.fetch(new Request('https://auto-brain.example/'), env);

    expect(await response.text()).toBe('ok');
  });

  it('runs the server image on port 8080 and lets idle instances sleep after ten minutes', () => {
    expect(construct(BrainContainer)).toMatchObject({ defaultPort: 8080, sleepAfter: '10m' });
  });
});
