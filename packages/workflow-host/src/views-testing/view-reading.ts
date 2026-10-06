import { Effect } from 'effect';
import { expect, vi } from 'vitest';

import type { KeptView } from '../views/view-rows.ts';
import type { ViewsPort } from '../views/views-port.ts';
import { alpha, viewTestTimeoutMs, type Brain } from './view-documents.ts';

export interface ViewReading {
  readonly viewOf: (name: string, brain?: Brain) => Promise<KeptView | undefined>;
  readonly until: (name: string, holds: (view: KeptView) => boolean, brain?: Brain) => Promise<KeptView>;
  readonly gone: (name: string) => Promise<boolean>;
}

const waiting = { timeout: viewTestTimeoutMs - 5000, interval: 20 };

export function viewReadingOf(views: ViewsPort): ViewReading {
  const viewOf: ViewReading['viewOf'] = (name, brain = alpha) => Effect.runPromise(views.viewOf(brain, name));
  return {
    viewOf,
    until: (name, holds, brain = alpha) =>
      vi.waitFor(async () => {
        const view = await viewOf(name, brain);
        if (view === undefined || !holds(view)) {
          throw new Error(`The view of ${name} does not hold yet: ${JSON.stringify(view)}`);
        }
        return view;
      }, waiting),
    gone: (name) =>
      vi.waitFor(async () => {
        expect(await viewOf(name)).toBeUndefined();
        return true;
      }, waiting),
  };
}
