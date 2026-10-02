import { describe, expect, it } from 'vitest';

import { FakeCancellation } from './fake-cancellation.ts';
import { fakeHost } from './fake-host.ts';
import { virtualClock } from './virtual-clock.ts';
import { yamlObject } from './workflows.ts';

describe('the fake host', () => {
  it('drives work to its end, rejecting with what the work rejects with', async () => {
    const fake = fakeHost();

    await expect(fake.drive(() => Promise.reject(new Error('broken')))).rejects.toThrow('broken');
  });

  it('tells when the work waits for something that never comes', async () => {
    const fake = fakeHost();

    await expect(fake.drive(() => fake.host.waitUntil(() => false))).rejects.toThrow(
      'The workflow waits for something that never comes',
    );
  });

  it('runs an operation started outside drive in its root scope', async () => {
    const fake = fakeHost();
    const sleeping = fake.host.sleep(5, 'outside');
    fake.cancelWorkflow();

    await expect(sleeping).rejects.toBeInstanceOf(FakeCancellation);
    await expect(fake.host.sleep(5, 'after')).rejects.toBeInstanceOf(FakeCancellation);
  });

  it('draws the middle of the range when it is given no random value', () => {
    expect(fakeHost().host.random()).toBe(0.5);
  });
});

describe('the virtual clock', () => {
  it('fires timers due at the same time in the order they were set', () => {
    const clock = virtualClock();
    const fired: string[] = [];
    const firing = (name: string) => () => {
      fired.push(name);
    };
    clock.timer(10, firing('first'));
    clock.timer(10, firing('second'));
    clock.timer(5, firing('earliest'));

    expect([clock.advance(), clock.advance(), clock.advance(), clock.advance()]).toEqual([true, true, true, false]);
    expect(fired).toEqual(['earliest', 'first', 'second']);
  });
});

describe('the YAML of a test', () => {
  it('must be a mapping', () => {
    expect(() => yamlObject('- a list')).toThrow('The YAML is not a JSON object');
  });
});
