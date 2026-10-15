import { listed } from '@on.auto/operations';

interface Unit {
  readonly per: number;
  readonly one: string;
  readonly other: string;
}

interface Counting {
  readonly rest: number;
  readonly parts: readonly string[];
}

const units: readonly Unit[] = [
  { per: 86_400_000, one: 'day', other: 'days' },
  { per: 3_600_000, one: 'hour', other: 'hours' },
  { per: 60_000, one: 'minute', other: 'minutes' },
  { per: 1000, one: 'second', other: 'seconds' },
  { per: 1, one: 'millisecond', other: 'milliseconds' },
];

const counted = new Intl.NumberFormat('en');

function countedIn({ rest, parts }: Counting, { per, one, other }: Unit): Counting {
  const amount = Math.floor(rest / per);
  return amount === 0
    ? { rest, parts }
    : { rest: rest - amount * per, parts: [...parts, `${counted.format(amount)} ${amount === 1 ? one : other}`] };
}

export function durationInWords(milliseconds: number): string {
  const start: Counting = { rest: Math.max(0, Math.round(milliseconds)), parts: [] };
  const { parts } = units.reduce((counting, unit) => countedIn(counting, unit), start);
  return parts.length === 0 ? '0 seconds' : listed(parts);
}
