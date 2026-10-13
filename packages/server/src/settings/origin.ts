import { Schema } from 'effect';

export const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) => URL.parse(text)?.origin === text || 'Expected an origin such as https://app.example.com',
  ),
);

export const PublicUrl = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      (text.startsWith('https://') && URL.parse(text)?.origin === text) ||
      'Expected an https URL with no path, query or fragment, such as https://runtime.example.com',
  ),
);
