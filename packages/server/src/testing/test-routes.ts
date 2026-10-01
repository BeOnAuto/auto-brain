import { setTimeout } from 'node:timers/promises';

import type { RegisterRoutes } from '@beonauto/api';

export const testRoutes: RegisterRoutes = (routes) => {
  routes.add('GET', '/slow', async (c) => {
    const ms = Number(c.req.query('ms'));
    await setTimeout(ms, undefined, { ref: false });
    return c.json({ slept: ms });
  });
  routes.add('GET', '/fail', () => {
    throw new Error('database password is hunter2');
  });
  routes.add('GET', '/linger', (c) => {
    const ms = Number(c.req.query('ms'));
    void setTimeout(ms);
    return c.json({ lingering: ms });
  });
};
