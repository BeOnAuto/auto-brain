import { createHash } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import { html, raw } from 'hono/html';

import type { ApiEnv } from '../api-env.ts';

export const consoleOrigin = 'https://console.on.auto';

const fonts = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@500&family=DM+Sans:wght@400;500&display=swap';

const styles = `
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

const logo = `<svg class="logo" viewBox="100 100 435 435" role="img" aria-label="Auto">
  <path class="tile" d="M512.644 100H121.718C109.652 100 100 109.667 100 121.751V513.277C100 525.361 109.652 535.028 121.718 535.028H512.644C524.71 535.028 534.362 525.361 534.362 513.277V121.751C534.362 109.667 524.71 100 512.644 100Z"/>
  <path class="glyph" d="M413.706 481.86C451.11 481.86 481.274 451.649 481.274 414.189C481.274 376.728 451.11 346.518 413.706 346.518C376.303 346.518 346.139 376.728 346.139 414.189C346.139 451.649 376.303 481.86 413.706 481.86Z"/>
  <path class="glyph" d="M153.089 347.968C153.089 347.243 153.813 346.518 154.537 346.518H287.017C287.741 346.518 288.465 347.243 288.465 347.968V412.98C288.465 413.705 287.741 414.43 287.017 414.43H257.095C256.371 414.43 255.647 415.155 255.647 415.88V480.893C255.647 481.618 254.923 482.343 254.199 482.343H188.321C187.597 482.343 186.873 481.618 186.873 480.893V415.88C186.873 415.155 186.149 414.43 185.425 414.43H154.296C153.572 414.43 152.848 413.705 152.848 412.98V347.968H153.089Z"/>
  <path class="glyph" d="M347.587 153.17C346.863 153.17 346.139 153.895 346.139 154.621V223.017C346.139 259.269 376.303 288.513 413.706 288.513C451.11 288.513 481.274 259.269 481.274 223.017V154.621C481.274 153.895 480.55 153.17 479.826 153.17H347.345H347.587Z"/>
  <path class="glyph" d="M153.33 286.339C152.848 287.306 153.33 288.272 154.537 288.272H286.776C287.742 288.272 288.465 287.306 287.983 286.339L221.863 154.139C221.381 153.172 219.933 153.172 219.45 154.139L153.33 286.339Z"/>
</svg>`;

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`;

const ownStyles = `<style>${styles}</style>`;

const contentSecurityPolicy = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}' https://fonts.googleapis.com`,
  'font-src https://fonts.gstatic.com',
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

function consoleOn(server: Readonly<URL>): string {
  return `${consoleOrigin}/?server=${encodeURIComponent(server.origin)}`;
}

function pageOf(server: Readonly<URL>): ReturnType<typeof html> {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Auto Brain</title>
        <link rel="stylesheet" href="${fonts}" />
        ${raw(ownStyles)}
      </head>
      <body>
        <main>
          ${raw(logo)}
          <h1>Auto Brain is running</h1>
          <p>Create and manage your brains in the console.</p>
          <span class="address">${server.host}</span>
          <a class="open" href="${consoleOn(server)}">Open console ${raw(arrow)}</a>
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
