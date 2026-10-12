import { Effect } from 'effect';
import { expect, vi } from 'vitest';

import type { KeptView } from '../views/view-rows.ts';
import type { ViewsPort } from '../views/views-port.ts';
import { alpha, viewTestTimeoutMs, type Playbook } from './view-documents.ts';

export interface ViewReading {
  readonly viewOf: (name: string, playbook?: Playbook) => Promise<KeptView | undefined>;
  readonly until: (name: string, holds: (view: KeptView) => boolean, playbook?: Playbook) => Promise<KeptView>;
  readonly gone: (name: string) => Promise<boolean>;
}

export const viewWaiting = { timeout: viewTestTimeoutMs - 5000, interval: 20 };

export function viewReadingOf(views: ViewsPort): ViewReading {
  const viewOf: ViewReading['viewOf'] = (name, playbook = alpha) => Effect.runPromise(views.viewOf(playbook, name));
  return {
    viewOf,
    until: (name, holds, playbook = alpha) =>
      vi.waitFor(async () => {
        const view = await viewOf(name, playbook);
        if (view === undefined || !holds(view)) {
          throw new Error(`The view of ${name} does not hold yet: ${JSON.stringify(view)}`);
        }
        return view;
      }, viewWaiting),
    gone: (name) =>
      vi.waitFor(async () => {
        expect(await viewOf(name)).toBeUndefined();
        return true;
      }, viewWaiting),
  };
}
