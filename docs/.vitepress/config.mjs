import { defineConfig } from 'vitepress';

import navigation from '../nav.json' with { type: 'json' };

export default defineConfig({
  title: 'Auto runtime',
  description: 'Contributor-owned documentation for the Auto brain runtime.',
  base: '/docs/',
  cleanUrls: true,
  srcExclude: ['decisions/**', 'engineering/**'],
  lastUpdated: true,
  head: [['meta', { name: 'robots', content: 'noindex' }]],
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/get-started/local' },
      { text: 'Runtime docs', link: '/' },
      { text: 'Auto', link: 'https://on.auto/' },
    ],
    sidebar: [{ text: 'Introduction', link: '/' }, ...navigation],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/BeOnAuto/auto-brain/edit/main/docs/:path',
      text: 'Edit this page in auto-brain',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/BeOnAuto/auto-brain' }],
    footer: { message: 'Runtime documentation preview. Published with Auto at on.auto/docs.' },
  },
});
