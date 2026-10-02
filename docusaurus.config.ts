import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'svir',
  tagline: 'A small, composable Rust SDK for talking to large language models.',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://romanemreis.github.io',
  baseUrl: '/svir-docs/',

  // GitHub pages deployment config.
  organizationName: 'RomanEmreis',
  projectName: 'svir-docs',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  // English is the source; Russian lives in i18n/ru. Translated pages keep
  // the English heading IDs ({/* #id */}), so anchors work in both locales.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ru'],
    localeConfigs: {
      en: {label: 'English'},
      ru: {label: 'Русский'},
    },
  },

  clientModules: ['./src/client/fonts.ts'],

  headTags: [
    // An SVG favicon where the browser takes one; `favicon` above is the
    // .ico fallback for the rest.
    {
      tagName: 'link',
      attributes: {rel: 'icon', type: 'image/svg+xml', href: '/svir-docs/img/favicon.svg'},
    },
    {
      tagName: 'link',
      attributes: {rel: 'apple-touch-icon', href: '/svir-docs/img/apple-touch-icon.png'},
    },
  ],

  // Offline search. The index is built from the rendered HTML at the end of
  // `docusaurus build` and shipped as a static asset, so search needs no
  // third-party service. Under `npm start` the search box is inert; use
  // `npm run build && npm run serve` to try it.
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // One index per locale, built from that locale's own pages. `ru`
        // brings in the lunr stemmer for Russian; without it the index would
        // be stemmed as English and match badly.
        language: ['en', 'ru'],
        // Content-hash the index filename, so a redeploy can never be served
        // a stale index out of a browser cache.
        hashed: true,
        indexBlog: false,
        // The `src/pages/examples/*.md` files are code fences imported into
        // the landing page, not pages anyone reads on their own.
        indexPages: false,
        docsRouteBasePath: 'docs',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/RomanEmreis/svir-docs/tree/main/',
          // A translated page links to its translation, not to the English source.
          editLocalizedFiles: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      {name: 'keywords', content: 'rust, llm, openai, chat completions, sse, streaming, tool calling, sdk'},
    ],
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'svir',
      logo: {
        alt: 'svir logo',
        src: 'img/logo-mark.svg',
        srcDark: 'img/logo-mark-dark.svg',
      },
      items: [
        // Plain links with their own patterns rather than `docSidebar` and
        // `doc` items: both of those count the whole sidebar as theirs, so
        // on any docs page both would be highlighted.
        {
          to: '/docs/intro',
          label: 'Docs',
          position: 'left',
          activeBaseRegex: '/docs/(?!agent-skill)',
        },
        {
          to: '/docs/agent-skill',
          label: 'Skill',
          position: 'left',
          activeBaseRegex: '/docs/agent-skill',
        },
        {
          href: 'https://docs.rs/svir/latest/svir/',
          label: 'API',
          position: 'left',
        },
        {
          href: 'https://crates.io/crates/svir',
          label: 'crates.io',
          position: 'right',
        },
        {
          href: 'https://github.com/RomanEmreis/svir',
          label: 'GitHub',
          position: 'right',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting started', to: '/docs/intro'},
            {label: 'Tools', to: '/docs/basics/tools'},
            {label: 'Layers', to: '/docs/client/layers'},
            {label: 'Agent Skill', to: '/docs/agent-skill'},
          ],
        },
        {
          title: 'Crate',
          items: [
            {label: 'crates.io', href: 'https://crates.io/crates/svir'},
            {label: 'API reference', href: 'https://docs.rs/svir/latest/svir/'},
            {label: 'Changelog', href: 'https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md'},
            {label: 'Examples', href: 'https://github.com/RomanEmreis/svir/tree/main/examples'},
          ],
        },
        {
          title: 'The family',
          items: [
            {label: 'volga - HTTP', href: 'https://github.com/RomanEmreis/volga'},
            {label: 'neva - MCP', href: 'https://romanemreis.github.io/neva-docs/'},
            {label: 'svir - LLMs', href: 'https://github.com/RomanEmreis/svir'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} svir. MIT OR Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      // One Dark, on the site's own dark gray rather than its blue-gray.
      darkTheme: {
        ...prismThemes.oneDark,
        plain: {...prismThemes.oneDark.plain, backgroundColor: '#14161b'},
      },
      additionalLanguages: ['bash', 'toml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
