import type { Context } from 'hono';

import type { ApiEnv } from './api-env.ts';

export type RouteHandler = (c: Context<ApiEnv>) => Response | Promise<Response>;

export interface Routes {
  readonly add: (method: string, path: string, handler: RouteHandler) => void;
}

export type RegisterRoutes = (routes: Routes) => void;
