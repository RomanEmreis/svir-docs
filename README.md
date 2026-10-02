# svir-docs

The documentation site for [svir](https://github.com/RomanEmreis/svir), a small, composable Rust
SDK for talking to large language models: <https://romanemreis.github.io/svir-docs/>.

Built with [Docusaurus](https://docusaurus.io/).

## Layout

```text
docs/              the pages, in English; the sidebar follows the tree (sidebar_position, _category_.json)
i18n/ru/           the Russian locale: translated pages, UI strings, and glossary.md for the terms
src/pages/         the landing page; examples/*.md are the code fences it shows
src/components/    landing page sections
src/theme/         swizzled CodeBlock: line numbers on Rust blocks by default
src/css/           the theme: ultramarine on black and dark gray
static/img/        logo marks (one per theme), the full logo, favicons, the social card
skill/svir/        the Agent Skill, packaged as static/svir-skill.zip on every build
ci/                build-skill.py packages the skill; check-snippets.py compiles the Rust snippets;
                   check-site.py checks the build
```

## Develop

```sh
npm ci
npm start          # dev server; search is inert here
npm run build      # production build, with broken links and anchors as errors
npm run serve      # serve the build, search included
python3 ci/check-site.py   # after a build: admonitions parsed, translations in step
```

`npm start` serves one locale; `npm start -- --locale ru` serves the Russian one.

## Translations

The Russian pages live in `i18n/ru/docusaurus-plugin-content-docs/current/`, one per English page.
Only the prose is translated: code blocks stay exactly as in English, and every heading keeps the
English ID with `{/* #id */}`, so anchor links work in both locales. `ci/check-site.py` fails the
build when either drifts. With the v4 future flags, an admonition's title goes in brackets:
`:::info[Title]`. UI strings are in `i18n/ru/code.json` and `i18n/ru/docusaurus-theme-classic/`;
`npm run write-translations -- --locale ru` adds new ones.

## Snippets compile

Every `rust` fence in `docs/`, in the landing page's examples, and in `skill/` is compiled against
the published svir crate, in CI and locally:

```sh
python3 ci/check-snippets.py --docs-dir docs
python3 ci/check-snippets.py --docs-dir src/pages/examples
python3 ci/check-snippets.py --docs-dir skill
```

A block opts out with `skip` in its fence's metastring (in `docs/`) or `<!-- snippet: skip -->` on
the line before it (in `skill/`), and names extra features the same way. `SVIR_VERSION` picks the
published version; `SVIR_PATH` points at a local checkout instead.

## License

MIT
