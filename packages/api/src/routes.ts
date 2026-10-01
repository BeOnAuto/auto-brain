import type { Context } from 'hono';

import type { ApiEnv } from './api-env.ts';
import type { ReportThrown } from './problem/error-boundary.ts';

export type RouteHandler = (c: Context<ApiEnv>) => Response | Promise<Response>;

export type Close = () => Promise<void>;

export interface Routes {
  readonly add: (method: string, path: string, handler: RouteHandler) => void;
  readonly onClose: (close: Close) => void;
  readonly reportThrown: ReportThrown;
}

export type RegisterRoutes = (routes: Routes) => void;
