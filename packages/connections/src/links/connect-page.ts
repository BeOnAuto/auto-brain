export interface ConnectPages {
  readonly studio: string;
  readonly runtime: () => string;
}

export interface PageOfALink {
  readonly org: string;
  readonly connection: string;
  readonly token: string;
}

export function connectPageOf({ studio, runtime }: ConnectPages, { org, connection, token }: PageOfALink): string {
  const page = new URL('/connect', studio);
  page.searchParams.set('server', runtime());
  page.searchParams.set('org', org);
  page.searchParams.set('connection', connection);
  page.searchParams.set('token', token);
  return page.href;
}
