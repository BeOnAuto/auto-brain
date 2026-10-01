import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { IncidentReporter } from './index.ts';
import { acmeAdmin } from './testing/callers.ts';
import { harness, toBrain, toOrg } from './testing/harness.ts';
import { explode, giveUp, linger, misreport } from './testing/probes.ts';

const toAlpha = toBrain('acme', 'alpha');

const incidentId = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

describe('the fault boundary', () => {
  it('turns a defect into an incident and hands the original to the reporter only', async () => {
    const { dispatcher, reported, run } = harness();

    const outcome = await run(dispatcher.inBrain(explode.registration, toAlpha(acmeAdmin)));

    expect(outcome).toEqual({ status: 'faulted', incident: reported()[0]?.incident });
    expect(JSON.stringify(outcome)).toMatch(new RegExp(`^\\{"status":"faulted","incident":"${incidentId}"\\}$`, 'u'));
    expect(reported().map(({ original }) => original)).toEqual([new Error('the store password is hunter2')]);
  });

  it('treats output that breaks the output schema as a fault', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.inOrg(misreport.registration, toOrg('acme')(acmeAdmin)))).toEqual({
      status: 'faulted',
      incident: reported()[0]?.incident,
    });
  });

  it('still answers with an incident when the reporter fails', async () => {
    const failing = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: () => Effect.die('reporter down') }));
    const { dispatcher, run } = harness({ reporter: failing });

    const outcome = await run(dispatcher.inBrain(explode.registration, toAlpha(acmeAdmin)));

    expect(JSON.stringify(outcome)).toMatch(new RegExp(`^\\{"status":"faulted","incident":"${incidentId}"\\}$`, 'u'));
  });
});

describe('settling a call', () => {
  it('gives stopped for an interrupted call and reports nothing', async () => {
    const { dispatcher, reported, settleWithin } = harness();

    const settled = await settleWithin(
      20,
      dispatcher.inBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 })),
    );

    expect({ settled, reported: reported() }).toEqual({ settled: { status: 'stopped' }, reported: [] });
  });

  it('gives stopped for a call that interrupts itself, which is no fault', async () => {
    const { dispatcher, reported, settleWithin } = harness();

    const settled = await settleWithin(10_000, dispatcher.inBrain(giveUp.registration, toAlpha(acmeAdmin)));

    expect({ settled, reported: reported() }).toEqual({ settled: { status: 'stopped' }, reported: [] });
  });

  it('gives the outcome of a finished call', async () => {
    const { dispatcher, settleWithin } = harness();

    expect(
      await settleWithin(10_000, dispatcher.inBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 0 }))),
    ).toEqual({ status: 'done', output: { lingered: 0 } });
  });
});
