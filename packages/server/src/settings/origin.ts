import type { ServerConfig } from '@on.auto/config';
import { Option, Schema } from 'effect';

function isOriginOf(text: string, protocols: readonly string[]): boolean {
  const url = URL.parse(text);
  return url?.origin === text && protocols.includes(url.protocol);
}

export const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) => URL.parse(text)?.origin === text || 'Expected an origin such as https://app.example.com',
  ),
);

export const IssuerOrigin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      isOriginOf(text, ['https:']) ||
      'Expected the https URL of the identity service, with no path, query or fragment, such as https://clerk.on.auto',
  ),
);

export const PublicOrigin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      isOriginOf(text, ['https:', 'http:']) ||
      'Expected an https URL with no path, query or fragment, such as https://runtime.example.com',
  ),
);

const loopbackNames: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function namesALoopbackHost(origin: string): boolean {
  return loopbackNames.has(new URL(origin).hostname);
}

const loopbackNamesOfHosts: ReadonlyMap<string, string> = new Map([
  ['localhost', 'localhost'],
  ['127.0.0.1', 'localhost'],
  ['::1', '[::1]'],
]);

export function ownLoopbackOrigin({ host, port }: ServerConfig): Option.Option<string> {
  const name = loopbackNamesOfHosts.get(host);
  return name === undefined || port === 0 ? Option.none() : Option.some(`http://${name}:${port}`);
}
