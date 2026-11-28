# Contributing to the svir docs

These rules keep the site in a shape that survives new svir releases without a
rewrite. `ci/check-docs.py`, `ci/check-site.py`, and `ci/check-snippets.py`
check the ones a script can check; the rest are on you and your reviewer.

## Who the docs are for

A Rust developer who builds an application on a model server, and may know
another LLM SDK: OpenAI's or Anthropic's, in Python or TypeScript.

* **Do not teach Rust.** Where an example needs a language feature (a trait,
  `Result`, a pattern, an `async fn`), name it in a sentence and link the
  [Rust Book](https://doc.rust-lang.org/book/).
* **Say where svir differs from what they know**, since that is where their
  code goes wrong: the system prompt is a field, the conversation is the
  request, the answer is one stream whose last item is the whole answer.
* **Lead with code that runs.** A page opens with what the feature does and a
  minimal complete example, then the details.

## Where a change goes

| Section | What it holds | Shape |
|---|---|---|
| Getting started (`intro.md`) | Install, a first call, what svir covers | Guide |
| Tutorial | One program built over four chapters | One growing `src/main.rs`, see [The tutorial](#the-tutorial) |
| Basics | Requests, attachments, answers, conversations, tools, structured output | Guide |
| Client | Configuration, the Anthropic Messages API, layers, features and TLS, a custom backend, tests | Guide |
| Advanced | What most apps never need: strictness and limits, a proxy, the codec alone | Guide |
| Errors, Troubleshooting | Error kinds; symptom to cause | Reference |
| Reference / Migration | What changes on upgrade, newest release first | Migration |
| Agent Skill (`skill/svir`) | The same material, written for a coding agent | See [The Agent Skill](#the-agent-skill) |

**A guide** follows this order:

1. One paragraph: what the feature does and when you need it.
2. The Cargo feature it needs, if it is not in the default build.
3. A minimal complete example.
4. Details, one `##` section per question a reader will ask.
5. Pitfalls, as admonitions next to the detail they belong to.
6. Links to the API reference on docs.rs and to the example in the svir
   repository, where there is one.

A difference between the two wire APIs goes into the guide it concerns, as a
column or a sentence; what only the Messages API has goes to
[Anthropic Messages](docs/client/anthropic.md).

## The tutorial

The [tutorial](docs/tutorial/overview.md) builds one program, `ralph`, a loop
that makes a crate's failing tests pass. Each chapter shows its new code in
pieces and ends with the whole `src/main.rs` in a `<details>` block.

* **The full listings are the source of truth.** The pieces in the text are
  copied from them, line for line, and marked `rust skip`; the listings are
  compiled.
* **Each chapter's program runs.** Build every listing as a binary of one
  scratch crate, with the dependencies the first chapter gives, and run it on
  a fresh copy of the practice crate from the overview.
* **Outputs shown in the text are captured from a run**, against the server
  and model the overview names, not written by hand. If a change alters what
  the program prints or does, capture them again, for every chapter it
  touches. A model answers differently each time: show what the run gave,
  and do not describe more in the text than the output shows.

## Versions

The guides describe the current release only. A reader should never need to
know which version introduced something.

* **No version history in guides.** Do not write "Since 0.1.4", "Upgrading
  from", "Before 0.2", "locked on 0.1.6", or their Russian equivalents
  ("Начиная с 0.1.4", "до версии 0.2"). `check-docs.py` fails on them.
  Describe how it works now.
* **Every change a user has to act on goes to
  [Migration](docs/reference/migration.md)**, in a `## 0.x.y` section at the
  top, under one of two headings:
  * **Does not compile:** the compiler, or Cargo, finds every place. Name the
    fix.
  * **Compiles, answers differently:** nothing flags these, so say what to
    look for.

  Each of these headings keeps an ID made of its release, so that a new
  section does not renumber the anchors below it:
  `### Does not compile {/* #021-does-not-compile */}`, in both locales.
* **One version everywhere.** Every `svir` dependency in a `Cargo.toml` snippet
  names the current minor release (`"0.2"`, not `"0.2.0"`), and so do
  `SVIR_VERSION` in CI, the default in `check-snippets.py`, the first bold
  release on the Migration page, and the release the intro page describes
  (`**svir 0.2**`). The skill's `svir-version` names the exact release, and
  the Agent Skill page shows the same. `check-docs.py` fails on any other.
* **An API that is gone leaves the guides** in the release that removes it.
  The old name appears only on the Migration page.

The Migration page and the Agent Skill page are about versions, so these rules
do not apply to them. Neither do the skill's files: their "(svir 0.1.5)" notes
help an agent working on a project locked on an older release.

## Code snippets

* **Every `rust` fence compiles** against the published crate:
  `check-snippets.py` builds each block as a crate of its own, in `docs/`, in
  the landing page's `src/pages/examples/`, and in `skill/`. A block that
  needs a feature beyond the defaults names it in its metastring,
  `rust features="schemars"`, or in `skill/` with
  `<!-- snippet: features="schemars" -->` on the line before it.
* **Opt out only for a shape that is not a program**, such as a trait impl with
  elided bodies: `rust skip`, or `<!-- snippet: skip -->` in `skill/`.
* **Prefer a complete item a reader can copy** over a fragment.
* **The code is the same in both locales**, character for character.
  `check-site.py` fails on a code block that drifted.
* **A `#[tokio::test]` is not run** by `check-snippets.py`, which builds and
  never runs. Run such code with `cargo test` in a scratch project before you
  publish it.

## Both locales

* **Every page in `docs/` has its Russian translation** in
  `i18n/ru/docusaurus-plugin-content-docs/current/`, at the same path.
  `check-docs.py` fails on a page without its pair.
* **A page is translated paragraph for paragraph**, with the same sections,
  tables, and lists in the same order, so that a later edit can be mirrored.
* **Only the prose is translated.** Code blocks stay exactly as in English, and
  every heading keeps the English ID with `{/* #id */}`, so anchor links work
  in both locales. `check-site.py` checks both.
* **Terms** come from [the glossary](i18n/ru/glossary.md). A new term gets a
  row there in the same pull request.
* **A new category** needs its Russian label and description in
  `i18n/ru/docusaurus-plugin-content-docs/current.json`; new UI strings go to
  `i18n/ru/code.json`.

## Links, headings, and the sidebar

* **Link with relative paths** to the page: `./client/features`,
  `../basics/attachments#context-admission`. `npm run build` fails on a broken
  link or anchor.
* **The sidebar follows the tree**: `sidebar_position` orders the pages of a
  folder, `_category_.json` names and orders the folders. Keep the positions
  the same in both locales.
* **Renaming a heading breaks its anchor.** Search for links to the old one, in
  both locales.
* **Do not move a published page** without a reason: its URL is linked from the
  svir repository, the skill, and elsewhere.

## The Agent Skill

`skill/svir` is a second, denser form of the same material, packaged as
`static/svir-skill.zip` on every build. When an API changes, update it in the
same pull request as the guide.

* `SKILL.md` names the release it describes in `svir-version`, and the Agent
  Skill page shows the same frontmatter. `check-docs.py` checks that they
  agree.
* `references/migration.md` gets the same upgrade notes as the Migration
  page, and keeps the table of what each older release lacks.
* A new reference file is listed in `SKILL.md`'s routing table, in
  `skill/svir/README.md`, and on the Agent Skill page.

## Checks before a pull request

```bash
npm run build                                          # the site builds; broken links fail
python3 ci/check-site.py                               # admonitions, translations in step
python3 ci/check-docs.py                               # one version, no history, both locales
python3 ci/check-snippets.py --docs-dir docs           # the Rust snippets on the site
python3 ci/check-snippets.py --docs-dir src/pages/examples
python3 ci/check-snippets.py --docs-dir skill
python3 ci/build-skill.py                              # the skill packages
```

CI runs all of them on every pull request.

## When svir releases

Do this for every release, in one pull request per release.

**Every release (0.x.y):**

1. Read the release's entry in the svir
   [changelog](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md), the
   pull requests behind it, and the decisions they record in `docs/decisions.md`.
2. For each change a user can notice, find the pages it touches in `docs/` and
   `skill/` (search for the API names) and update them to describe the new
   behavior, with no "since".
3. Add a `## 0.x.y` section to the top of the Migration page in both locales,
   and to `skill/svir/references/migration.md`, if anything needs a user's
   action.
4. A new feature goes to the page of its section, or to a new page if it is big
   enough; see [Where a change goes](#where-a-change-goes). A new Cargo feature
   also goes to [Features and TLS](docs/client/features.md).
5. Set `svir-version` in `skill/svir/SKILL.md`, and the same in the Agent Skill
   page's frontmatter block, in both locales.
6. Run the [checks](#checks-before-a-pull-request). If the release changed
   an API the tutorial uses, build its listings and capture its outputs
   again; see [The tutorial](#the-tutorial).

**A new minor release (0.x.0) also moves the version everywhere:**

```bash
OLD=0.2 NEW=0.3
grep -rlE "svir = \"$OLD\"|svir = \{ version = \"$OLD\"" docs i18n skill \
  | xargs sed -i -E "s/(svir = |svir = \{ version = )\"$OLD\"/\1\"$NEW\"/g"
sed -i "s/SVIR_VERSION: \"$OLD\"/SVIR_VERSION: \"$NEW\"/" .github/workflows/ci.yml
sed -i "s/\"SVIR_VERSION\", \"$OLD\"/\"SVIR_VERSION\", \"$NEW\"/; s/default \"$OLD\"/default \"$NEW\"/" ci/check-snippets.py
```

Then set the current release in the first paragraph of the Migration page
(`**0.3**`) and on the intro page (`**svir 0.3**`) in both locales, and run
`check-docs.py`: it lists any place the commands missed. Expect
`check-snippets.py` to fail where the release broke an example; fixing those
is the main work of a minor release.
