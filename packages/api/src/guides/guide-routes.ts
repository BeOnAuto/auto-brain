import { versionPrefix } from '../operations/route-table.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes } from '../routes.ts';
import { guideMediaType } from './guide-resources.ts';
import type { GuideShelf } from './guide-shelf.ts';

export const guidesPathPrefix = `${versionPrefix}/guides/`;

const noSuchGuide = problemOf('not_found', 'The server holds no guide of that name');

export function guideRoutesOf({ named }: GuideShelf): RegisterRoutes {
  return (routes) => {
    routes.add('GET', `${guidesPathPrefix}:guide`, (c) => {
      const guide = named(String(c.req.param('guide')));
      return guide === undefined
        ? problemResponse(noSuchGuide)
        : new Response(guide.text, {
            headers: { 'content-type': `${guideMediaType}; charset=utf-8`, 'cache-control': 'no-store' },
          });
    });
  };
}
