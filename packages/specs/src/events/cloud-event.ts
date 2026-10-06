import { Schema } from 'effect';

import { mostInputDepth, nestsWithin } from '../execution/recorded-size.ts';

export const mostPublishedEventBytes = 245_760;

export const mostEventDataDepth = mostInputDepth - 2;

const mostIdLength = 256;

const mostTypeLength = 256;

const mostTextLength = 1024;

const leastExtensionInteger = -2_147_483_648;

const mostExtensionInteger = 2_147_483_647;

const contextAttributes: ReadonlySet<string> = new Set([
  'specversion',
  'id',
  'source',
  'type',
  'subject',
  'time',
  'datacontenttype',
  'dataschema',
  'data',
]);

const uriCharacters = String.raw`(?:[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})`;

const uriReference = new RegExp(String.raw`^${uriCharacters}+$`, 'u');

const absoluteUri = new RegExp(String.raw`^[A-Za-z][A-Za-z0-9+.\-]*:${uriCharacters}*$`, 'u');

const rfc3339 =
  /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d{1,9})?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

const extensionName = /^[a-z0-9]+$/u;

function dayExists(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCDate() === day;
}

function isTime(written: string): boolean {
  const parts = rfc3339.exec(written)?.groups;
  return parts !== undefined && dayExists(Number(parts['year']), Number(parts['month']), Number(parts['day']));
}

function isExtensionInteger(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= leastExtensionInteger &&
    value <= mostExtensionInteger
  );
}

function isExtensionValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'boolean' || isExtensionInteger(value);
}

function extensionIssues(event: { readonly [attribute: string]: unknown }) {
  return Object.entries(event).flatMap(([name, value]: readonly [string, unknown]) => {
    if (contextAttributes.has(name)) {
      return [];
    }
    if (!extensionName.test(name)) {
      return [{ path: [name], issue: 'Expected the name of an extension attribute: lowercase letters and digits' }];
    }
    return isExtensionValue(value)
      ? []
      : [{ path: [name], issue: 'Expected text, a boolean, or an integer from -2147483648 to 2147483647' }];
  });
}

function boundedText(most: number, description: string) {
  return Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(most)).annotate({
    description: `${description}, 1 to ${most} characters`,
  });
}

const TimeField = Schema.String.check(
  Schema.makeFilter(isTime, { expected: 'a time in RFC 3339, such as 2026-10-05T09:00:00Z' }),
).annotate({ description: 'When it happened, in RFC 3339, such as 2026-10-05T09:00:00Z' });

const unique = 'The id of the event, unique among the events of its source';

const contextFields = {
  source: Schema.String.check(
    Schema.isMaxLength(mostTextLength),
    Schema.makeFilter((source: string) => uriReference.test(source), {
      expected: 'a URI reference that is not empty, such as /ledger/eu or https://acme.example/ledger',
    }),
  ).annotate({
    description: `Where the event comes from, a URI reference such as /ledger/eu, 1 to ${mostTextLength} characters`,
  }),
  type: boundedText(mostTypeLength, 'What happened, such as com.acme.ledger.month-closed'),
  subject: Schema.optionalKey(boundedText(mostTextLength, 'What the event is about, within its source')),
  datacontenttype: Schema.optionalKey(boundedText(mostTypeLength, 'The media type of data, such as application/json')),
  dataschema: Schema.optionalKey(
    boundedText(mostTextLength, 'The schema data follows, an absolute URI').check(
      Schema.makeFilter((schema: string) => absoluteUri.test(schema), { expected: 'an absolute URI' }),
    ),
  ),
  data: Schema.optionalKey(
    Schema.Json.annotate({
      description: `What the event carries, any JSON value that nests at most ${mostEventDataDepth} levels deep`,
    }).check(
      Schema.makeFilter((data: Schema.Json) => nestsWithin(data, mostEventDataDepth), {
        expected: `data that nests at most ${mostEventDataDepth} levels deep, so that a run can hold the event in a list`,
      }),
    ),
  ),
};

const extensionsCheck = Schema.makeFilter(extensionIssues);

const ExtensionsSchema = Schema.Record(Schema.String, Schema.Json);

const extensionsInWords =
  'Any other attribute is an extension: its name lowercase letters and digits, its value text, a boolean, or an integer from -2147483648 to 2147483647, kept as given.';

export const EventToPublishSchema = Schema.StructWithRest(
  Schema.Struct({
    specversion: Schema.optionalKey(
      Schema.Literal('1.0').annotate({
        description: 'The version of CloudEvents the event follows; 1.0 when left out',
      }),
    ),
    id: Schema.optionalKey(boundedText(mostIdLength, `${unique}; made when left out`)),
    ...contextFields,
    time: Schema.optionalKey(
      TimeField.annotate({
        description:
          'When it happened, in RFC 3339, such as 2026-10-05T09:00:00Z; when the brain records it, if left out',
      }),
    ),
  }),
  [ExtensionsSchema],
)
  .check(extensionsCheck)
  .annotate({ description: `An event in the shape of CloudEvents 1.0. ${extensionsInWords}` });

export type EventToPublish = typeof EventToPublishSchema.Type;

export const CloudEventSchema = Schema.StructWithRest(
  Schema.Struct({
    specversion: Schema.Literal('1.0'),
    id: boundedText(mostIdLength, unique),
    ...contextFields,
    time: TimeField,
  }),
  [ExtensionsSchema],
)
  .check(extensionsCheck)
  .annotate({
    identifier: 'CloudEvent',
    description: `An event in the shape of CloudEvents 1.0. ${extensionsInWords}`,
  });

export type CloudEvent = typeof CloudEventSchema.Type;
