import { listed } from '@on.auto/operations';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const wholeNumber = /^\d{1,2}$/u;

const dayRange = /^(?<first>\d)-(?<last>\d)$/u;

const dayList = /^\d(?:,\d)+$/u;

const cronFields = 5;

function numberIn(field: string, least: number, most: number): number | undefined {
  const number = wholeNumber.test(field) ? Number(field) : Number.NaN;
  return number >= least && number <= most ? number : undefined;
}

function dayName(field: string): string | undefined {
  const day = numberIn(field, 0, 7);
  return day === undefined ? undefined : String(dayNames[day]);
}

function rangeWords(first: string, last: string): string | undefined {
  const from = dayName(first);
  const to = dayName(last);
  return from === undefined || to === undefined || Number(first) >= Number(last) ? undefined : `from ${from} to ${to}`;
}

function weekdaysWords(field: string): string | undefined {
  const range = dayRange.exec(field)?.groups;
  if (range !== undefined) {
    return rangeWords(String(range['first']), String(range['last']));
  }
  const days = dayList.test(field) ? field.split(',').map((day) => dayName(day)) : [dayName(field)];
  const named = days.filter((day) => day !== undefined);
  if (named.length < days.length) {
    return undefined;
  }
  return named.length === 1 ? `every ${String(named[0])}` : `on ${listed(named)}`;
}

function daysWords(dayOfMonth: string, month: string, dayOfWeek: string): string | undefined {
  if (month !== '*') {
    return undefined;
  }
  if (dayOfMonth === '*') {
    return dayOfWeek === '*' ? 'every day' : weekdaysWords(dayOfWeek);
  }
  const day = dayOfWeek === '*' ? numberIn(dayOfMonth, 1, 31) : undefined;
  return day === undefined ? undefined : `on day ${day} of each month`;
}

function twoDigits(number: number): string {
  return String(number).padStart(2, '0');
}

export function cronInWords(expression: string): string | undefined {
  const fields = expression.trim().split(/\s+/u);
  const at = (index: number) => String(fields[index]);
  const minute = numberIn(at(0), 0, 59);
  const hour = numberIn(at(1), 0, 23);
  const days = fields.length === cronFields ? daysWords(at(2), at(3), at(4)) : undefined;
  return minute === undefined || hour === undefined || days === undefined
    ? undefined
    : `at ${twoDigits(hour)}:${twoDigits(minute)} UTC ${days}`;
}
