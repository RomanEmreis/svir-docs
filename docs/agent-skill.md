---
sidebar_position: 7
title: Agent Skill
description: A packaged Agent Skill that teaches a coding assistant to write svir correctly.
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# Agent Skill

A packaged [Agent Skill](https://agentskills.io/specification) that teaches a
coding assistant to write svir correctly: the same material as this site,
reorganized for a model rather than a reader.

<a href={useBaseUrl('/svir-skill.zip')} download className="button button--primary button--lg">Download svir-skill.zip</a>

Source: [`skill/svir`](https://github.com/RomanEmreis/svir-docs/tree/main/skill/svir).

## Why you might want it

svir's shape is unlike the LLM SDKs most code was written against. The
conversation is the request, the system prompt is a field, the answer is one
stream whose last item is the whole answer, and an error is a kind to match
on. An assistant writing from habit reaches for a `system` role message,
`choices[0].delta.content`, or a client that remembers the chat. That code does
not compile here, or worse, compiles and loses the tool calls.

The skill front-loads exactly those traps, thirteen non-negotiables, and then
routes to detail on demand.

## What is in it

| File | Covers |
|---|---|
| `SKILL.md` | Establishing the version and the features, a call and a tool loop that work, the non-negotiables, routing |
| `references/requests.md` | The system prompt, messages and parts, attachments, reasoning effort, conversations, storing and restoring |
| `references/streaming.md` | Events, the completion, reasoning, usage and speed, cancelling, strict and lenient, limits, failures |
| `references/tools.md` | `Tool`, the `Tools` registry, schemas from types, the loop, streamed, a `Toolbox` of one's own |
| `references/client.md` | Base URL, API keys, extra headers, timeouts, listing models, layers, TLS providers, a custom HTTP backend, tests without a server |
| `references/codec.md` | A proxy that relays the stream, `Encoder` and `Decoder` alone, a transport of one's own |
| `references/errors.md` | Error kinds, and symptom to cause at runtime and at compile time |

`SKILL.md` stays short on purpose: an entrypoint the agent always reads, and
six references it loads only when the task needs one.

## Install

The SKILL.md format is a shared standard, so installation is the same
everywhere: unzip and **copy the `svir/` directory into the tool's skills
folder**, keeping the folder name. It has to match the `name` in the
frontmatter.

| Tool | Personal | Per project |
|---|---|---|
| Claude Code | `~/.claude/skills/svir/` | `.claude/skills/svir/` |
| opencode | `~/.config/opencode/skills/svir/` | `.opencode/skills/svir/` |
| Codex CLI | `~/.codex/skills/svir/` | `.codex/skills/svir/` |

```bash
unzip svir-skill.zip
mkdir -p ~/.claude/skills && cp -r svir ~/.claude/skills/
```

Restart the assistant afterwards: skills are discovered at startup.

opencode also reads `.claude/skills/` and `.agents/skills/`, so a single copy
inside a project can serve more than one tool.

### Anything else

Any assistant that can read a file will do. Point it at `SKILL.md` and let it
follow the links, or add a line to the project's `AGENTS.md`:

```markdown
For Rust code that talks to LLMs with the `svir` crate, read
`.agents/skills/svir/SKILL.md` and the reference file it routes you to.
```

## The code in it compiles

Every Rust snippet in the skill is a complete set of items, and every one is
compiled against the published `svir` crate in this repository's CI, with the
`schemars` and `tracing` features on. What an assistant copies out of it
builds. That is the point of shipping a skill rather than a prose summary: an
assistant that pastes a plausible-looking API is worse than one that pastes a
verified one.

The code on this site is held to the same check. To run it yourself after
editing:

```bash
python3 ci/check-snippets.py --docs-dir skill
```

## Version

The skill tracks svir **0.1.4**: OpenAI-compatible Chat Completions, streamed.
The frontmatter records it, so an assistant can tell whether the skill matches
the crate in front of it:

```yaml
metadata:
  svir-version: "0.1.4"
  msrv: "1.85"
  wire-api: "OpenAI-compatible Chat Completions, streaming"
```

It also tells the assistant what changed between 0.1 releases, for a project
locked on an older one.
