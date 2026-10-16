import type { LinkToOpen, Outcome, RegisteredPlainLanguage, Succeeded } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionSchema } from '../registry/connection.ts';
import { added, crm, notes, statusesOf } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

function wordsOf(h: Harness, name: string): RegisteredPlainLanguage {
  const { registration } = operationNamed(h.operations, name);
  if (!('plainLanguage' in registration) || registration.plainLanguage === undefined) {
    throw new Error(`The operation ${name} has no words`);
  }
  return registration.plainLanguage;
}

function outputOf(outcome: Outcome<Succeeded>): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

async function outcomeWords(h: Harness, name: string, input: Readonly<Record<string, unknown>>): Promise<string> {
  const outcome = await h.call(operationNamed(h.operations, name), ada, input);
  return wordsOf(h, name).outcome(outputOf(outcome), input);
}

async function linkOf(h: Harness): Promise<LinkToOpen | undefined> {
  const { registration } = operationNamed(h.operations, 'add_connection');
  const outcome = await h.call({ registration }, ada, crm);
  return 'linkToOpen' in registration ? registration.linkToOpen?.(outputOf(outcome)) : undefined;
}

const decodeConnection = Schema.decodeUnknownSync(ConnectionSchema);

describe('the words of adding a connection', () => {
  it('say what was added and where the person approves it, leaving the link to the details beside them', async () => {
    expect(await outcomeWords(harness(), 'add_connection', notes)).toBe(
      'Added the connection “notes”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes.',
    );
  });

  it('ask an agent to have the person open the link of the connection', async () => {
    const link = await linkOf(harness());

    expect(link?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within ten minutes.',
    );
    expect(link?.url).toMatch(/^https:\/\/studio\.on\.auto\/connect\?server=http%3A%2F%2Flocalhost%3A5555&org=acme&/u);
  });
});

describe('the words of listing connections', () => {
  it('list them by name and status, and say when there is none', async () => {
    const h = harness();
    const empty = await outcomeWords(h, 'list_connections', {});
    await added(h, notes);
    const one = await outcomeWords(h, 'list_connections', {});
    await statusesOf(
      h,
      Array.from({ length: 21 }, (_, index) => ({ ...crm, name: `crm-${String(index)}` })),
    );

    expect([empty, one]).toEqual(['The org has no connection.', 'There is 1 connection: “notes”, pending.']);
    expect(await outcomeWords(h, 'list_connections', {})).toMatch(
      /^There are 22 connections: “crm-20”, pending, .* and 2 more\.$/u,
    );
  });
});

describe('the words of one connection', () => {
  it('say where it stands, and why it is broken', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const record = decodeConnection(
      outputOf(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })),
    );
    const standing = wordsOf(h, 'get_connection');

    expect(await outcomeWords(h, 'get_connection', { id })).toBe(
      'The connection “notes” waits for the person who added it to approve it.',
    );
    expect([
      standing.outcome({ ...record, status: 'connected' }, { id }),
      standing.outcome({ ...record, status: 'removed' }, { id }),
      standing.outcome({ ...record, status: 'broken', broken: 'Its key is lost' }, { id }),
    ]).toEqual([
      'The connection “notes” is connected.',
      'The connection “notes” was removed.',
      'The connection “notes” is broken: Its key is lost.',
    ]);
    expect(await outcomeWords(h, 'remove_connection', { id })).toBe(
      'Removed the connection “notes”. No playbook may use it, and its credential is forgotten.',
    );
  });
});

describe('the words of a tool that could not do what it was asked', () => {
  it('name what it tried to do', () => {
    const h = harness();

    expect([
      wordsOf(h, 'add_connection').attempt(notes),
      wordsOf(h, 'list_connections').attempt({}),
      wordsOf(h, 'get_connection').attempt({ id: 'crm-id' }),
      wordsOf(h, 'remove_connection').attempt({ id: 'crm-id' }),
    ]).toEqual([
      'add the connection “notes”',
      'list the connections',
      'look up the connection “crm-id”',
      'remove the connection “crm-id”',
    ]);
    expect(() => wordsOf(h, 'read_link')).toThrow('The operation read_link has no words');
    expect(() => operationNamed(h.operations, 'nothing')).toThrow('There is no operation nothing');
  });
});
