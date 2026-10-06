import { brainCallerOf, messageIdOf } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, updateSpec, retireSpec, getExecution } = specOperationsFor([echo]);

const startVersion = defineStartVersion([echo]);

const toAlpha = toBrain('acme', 'alpha');

const theBrain = brainCallerOf({ org: 'acme', brain: 'alpha' });

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function greetAtTwoVersions() {
  const specs = harness();
  await specs.call(
    createSpec,
    toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await specs.call(updateSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }));
  return specs;
}

function starting(version: number, input: object = {}, id = executionId) {
  return toAlpha(theBrain, { primitive: 'echo', name: 'greet', version, input, execution_id: id });
}

describe('a start of one version of a definition, once', () => {
  it('runs the version it names, as the brain, with the depth and lineage of its request', async () => {
    const specs = await greetAtTwoVersions();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: executionId };

    const started = await specs.call(startVersion, { ...starting(1, { name: 'Ada' }), lineage, depth: 2 });

    expect(started).toEqual({
      status: 'succeeded',
      output: {
        execution_id: executionId,
        primitive: 'echo',
        name: 'greet',
        spec_version: 1,
        status: 'succeeded',
        output: { greeting: 'Hello', input: { name: 'Ada' } },
        started_at: firstMoment,
        started_by: 'brain:alpha',
        finished_at: firstMoment,
      },
    });
    expect(specs.ledger.streamNames().filter((stream) => stream.endsWith(executionId))).toEqual([
      `brain/acme/alpha/executions/${executionId}`,
    ]);
  });
});

describe('a start of a version once, under the id of a run', () => {
  it('answers the run that exists under its id and starts nothing, whatever it is asked', async () => {
    const specs = await greetAtTwoVersions();
    await specs.call(startVersion, starting(1));

    const again = await specs.call(startVersion, starting(2, { other: true }));
    const read = await specs.call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }));

    expect([again, read]).toMatchObject([
      { status: 'succeeded', output: { spec_version: 1, output: { greeting: 'Hello', input: {} } } },
      { status: 'succeeded', output: { spec_version: 1 } },
    ]);
  });

  it('starts a version that has since been retired, and is not_found for a version the definition never had', async () => {
    const specs = await greetAtTwoVersions();
    await specs.call(retireSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet' }));

    const retired = await specs.call(startVersion, starting(2));
    const missing = await specs.call(startVersion, starting(3, {}, '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b'));

    expect([retired, missing]).toMatchObject([
      { status: 'succeeded', output: { spec_version: 2, output: { greeting: 'Hi' } } },
      {
        status: 'rejected',
        reason: 'not_found',
        detail: 'There is no version 3 of the echo definition greet in this brain',
      },
    ]);
  });
});

async function probedOnce() {
  const prober = probe();
  const { createSpec: creating } = specOperationsFor([prober.primitive]);
  const specs = harness();
  await specs.call(creating, toAlpha(acmeAdmin, { primitive: 'probe', name: 'react', source: 'react' }));
  const startingProbe = defineStartVersion([prober.primitive]);
  const startOnce = () =>
    specs.call(
      startingProbe,
      toAlpha(theBrain, { primitive: 'probe', name: 'react', version: 1, input: {}, execution_id: executionId }),
    );
  return { prober, startOnce };
}

describe('a start of a version once whose run ended without a result', () => {
  it('runs again under the same id, so a start the brain could not take at first goes through later', async () => {
    const { prober, startOnce } = await probedOnce();
    prober.sufferOnNextRun('unavailable');

    const first = await startOnce();
    const again = await startOnce();

    expect([first, again, prober.runs()]).toMatchObject([
      { status: 'rejected', reason: 'unavailable' },
      { status: 'succeeded', output: { status: 'succeeded' } },
      2,
    ]);
  });
});

describe('a start of a version once while its run goes', () => {
  it('answers the run as it stands and runs nothing', async () => {
    const { prober, startOnce } = await probedOnce();
    prober.sufferOnNextRun('stall');
    void startOnce();
    await prober.stalled;

    const again = await startOnce();

    expect([again, prober.runs()]).toMatchObject([{ status: 'succeeded', output: { status: 'started' } }, 1]);
  });
});

describe('the words of a start of a version once', () => {
  it('name what it starts and why', () => {
    expect(
      startVersion.registration.plainLanguage?.attempt({
        primitive: 'echo',
        name: 'greet',
        version: 1,
        input: {},
        execution_id: executionId,
      }),
    ).toBe('start the greeting “greet” once, for what it reacts to');
  });
});

describe('the definitions of a brain that start on their own', () => {
  it('say so, and a read of one names the record its current version was made by', async () => {
    const specs = harness();
    const { getSpec } = specOperationsFor([echo]);
    const source = '{"greeting": "Hello", "reacts": true}';
    await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source }));
    await specs.call(
      createSpec,
      toAlpha(acmeAdmin, { primitive: 'echo', name: 'plain', source: '{"greeting": "Hi"}' }),
    );

    const read = await specs.call(getSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet' }));
    const plain = await specs.call(getSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'plain' }));

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { reacts: true, reacts_since: messageIdOf('brain/acme/alpha/specs/echo', 1) },
    });
    expect(plain).not.toMatchObject({ output: { reacts: true } });
  });
});
