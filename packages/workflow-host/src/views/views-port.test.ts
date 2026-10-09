import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { alpha } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';

describe('the port to the views a host keeps', () => {
  it('tells when the brain last recorded anything, and of no view a brain does not keep', async () => {
    const views = await viewHarness(await onSQLite());
    const newestAt = () => Effect.runPromise(views.store.views.newestRecordAt(alpha));

    const before = await newestAt();
    await views.ran('reasoning/runs', 1);
    const after = await newestAt();

    expect(before).toBeUndefined();
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(await views.viewOf('missing')).toBeUndefined();
  });
});
