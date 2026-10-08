import { asSentence, counted, listed, quoted, type Noun } from '@beonauto/operations';

import type { Brain } from '../registry/brain.ts';

const brainNoun: Noun = { one: 'brain', other: 'brains' };

const retiredBrainNoun: Noun = { one: 'retired brain', other: 'retired brains' };

const mostNamed = 20;

export function brainNamed({ name }: Pick<Brain, 'name'>): string {
  return `the brain ${quoted(name)}`;
}

export function purposeOf({ description }: Pick<Brain, 'description'>, withoutDescription = ''): string {
  return description.trim() === '' ? withoutDescription : ` What it is for: ${asSentence(description)}`;
}

function namesOf(brains: readonly Brain[]): string {
  const named = brains.slice(0, mostNamed).map(({ name }) => quoted(name));
  const others = brains.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

function inUse(brains: readonly Brain[]): string {
  if (brains.length === 0) {
    return 'There is no brain in use that this connection may see.';
  }
  const verb = brains.length === 1 ? 'is' : 'are';
  return `There ${verb} ${counted(brains.length, brainNoun)}: ${namesOf(brains)}.`;
}

function retiredOf(brains: readonly Brain[]): string {
  return brains.length === 0 ? '' : ` Also listed, ${counted(brains.length, retiredBrainNoun)}: ${namesOf(brains)}.`;
}

export function brainsListed(brains: readonly Brain[]): string {
  return `${inUse(brains.filter(({ status }) => status === 'active'))}${retiredOf(brains.filter(({ status }) => status === 'retired'))}`;
}

export function brainStanding({ name, status }: Pick<Brain, 'name' | 'status'>): string {
  return status === 'active'
    ? `The brain ${quoted(name)} is in use.`
    : `The brain ${quoted(name)} has been retired; it can no longer change.`;
}
