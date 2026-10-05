import { readFileSync } from 'node:fs';

function embedded(file: string): string {
  const font = readFileSync(new URL(`./fonts/${file}`, import.meta.url)).toString('base64');
  return `url(data:font/woff2;base64,${font}) format('woff2')`;
}

export const fontFaces = `
@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: ${embedded('dm-mono-latin-500.woff2')};
}
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: ${embedded('dm-sans-latin-variable.woff2')};
}
`;
