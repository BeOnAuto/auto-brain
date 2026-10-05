import { createHash } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import { html, raw } from 'hono/html';

import type { ApiEnv } from '../api-env.ts';
import { iconOnDark, iconOnLight, mark } from './auto-logo.ts';
import { fontFaces } from './fonts.ts';

export const studioOrigin = 'https://studio.on.auto';

const styles = `${fontFaces}
:root {
  color-scheme: light dark;
  --paper: #ffffff;
  --ink: #121212;
  --rule: #12121233;
  --muted: #666666;
  --focus: #0088b8;
  --running: #5ec72d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #121212;
    --ink: #ffffff;
    --rule: #ffffff33;
    --muted: #b8b8b8;
    --focus: #42c3f7;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  padding: 16px;
  display: flex;
  background: var(--paper);
  color: var(--ink);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
}
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border: 1px solid var(--rule);
  border-radius: 20px;
  text-align: center;
}
.logo { width: 52px; height: 52px; }
.logo .tile { fill: var(--ink); }
.logo .glyph { fill: var(--paper); }
h1 {
  margin: 14px 0 0;
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.8px;
}
p {
  margin: 8px 0 18px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--muted);
}
.address {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--running) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--running) 10%, transparent);
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
}
.address::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--running);
}
.open {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-top: 24px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--paper);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.open:hover { background: color-mix(in srgb, var(--ink) 90%, transparent); }
.open:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.open svg { width: 16px; height: 16px; }
`;

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`;

const ownStyles = `<style>${styles}</style>`;

const contentSecurityPolicy = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'`,
  'font-src data:',
  'img-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const pageHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': contentSecurityPolicy,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function pageOf(server: Readonly<URL>): ReturnType<typeof html> {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Auto Brain</title>
        <link rel="icon" href="${iconOnLight}" media="(prefers-color-scheme: light)" />
        <link rel="icon" href="${iconOnDark}" media="(prefers-color-scheme: dark)" />
        ${raw(ownStyles)}
      </head>
      <body>
        <main>
          ${raw(mark)}
          <h1>Auto Brain is running</h1>
          <p>Auto Studio is invite-only.</p>
          <span class="address">${server.host}</span>
          <a class="open" href="https://on.auto/request-invite">Request a Studio invite ${raw(arrow)}</a>
        </main>
      </body>
    </html>`;
}

function asksForThePage(method: string, path: string, accept: string): boolean {
  return method === 'GET' && path === '/' && accept.includes('text/html');
}

export const landingPage: MiddlewareHandler<ApiEnv> = (c, next) =>
  asksForThePage(c.req.method, c.req.path, c.req.header('accept') ?? '')
    ? Promise.resolve(c.html(pageOf(new URL(c.req.url)), 200, pageHeaders))
    : next();
