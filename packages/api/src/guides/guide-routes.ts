import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { guideMediaType } from './guide-resources.ts';
import type { Guide, GuideShelf } from './guide-shelf.ts';

const guideHeaders = { 'content-type': `${guideMediaType}; charset=utf-8`, 'cache-control': 'no-store' };

function guidePathOf({ name }: Pick<Guide, 'name'>): string {
  return `${versionPrefix}/guides/${name}`;
}

export function guideRoutes({ everyGuide }: GuideShelf): RegisterRoutes {
  return (routes) => {
    for (const guide of everyGuide) {
      routes.addPublic('GET', guidePathOf(guide), () => new Response(guide.text, { headers: guideHeaders }));
    }
  };
}
