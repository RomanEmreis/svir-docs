---
sidebar_position: 1
title: A loop that fixes tests
sidebar_label: Overview
description: What the tutorial builds, how it works, and what you need before you start.
---

# Tutorial: a loop that fixes tests

This tutorial builds `ralph`, a command-line program that makes a failing
`cargo test` pass. It gives a model tools to read and write a crate's files and
to run its tests, and lets it work. When the model stops, the program runs the
tests itself. If they still fail, it starts the model again with a fresh
conversation, and all that carries over is the code and a notes file the model
keeps. It stops when the tests pass, or when it has spent its rounds or its
token budget.

A loop like this is sometimes called a Ralph loop: the same prompt, run again
and again with a clean context, the state kept in files instead of in the
conversation. It suits a job that a program can check, such as tests that pass
or fail, and that may need more than one conversation's worth of work.

Each chapter adds to the same program and ends with the whole `src/main.rs`,
so you can stop after any chapter with a program that runs.

It is written for developers who know some Rust and may have used an LLM SDK
in another language. It does not teach Rust: where the code needs a language
feature, the text names it and links to the
[Rust Book](https://doc.rust-lang.org/book/).

## How it works

```text
round, until the tests pass or ROUNDS or BUDGET is spent:
    cargo test                                   the program runs it, and decides
    a new request: the task, NOTES.md, the test output
    turn, until the model stops calling tools or TURNS is spent:
        stream the answer
        run its calls: list_files, read_file, write_file, run_tests
        send the answer and the results back
```

Both loops are the program's code. svir sends a request and streams back the
answer; it has no agent loop and keeps no conversation. That is what lets the
program decide what a round is, what carries over, and what a run may cost.

1. **[Project and first call](./first-call):** a client for an
   OpenAI-compatible server or the Anthropic Messages API, chosen when the
   program starts, and a streamed answer about the failing tests.
2. **[Tools](./tools):** four tools in a workspace the model cannot leave, the
   tool loop, calls shown as they stream, and calls the output limit cut
   short.
3. **[Rounds](./rounds):** a fresh conversation each round, notes that carry
   the work over, and the program, not the model, deciding when it is done.
4. **[Layers and a budget](./layers):** retries and a deadline around every
   call, a layer that counts tokens, and a budget the loop keeps to.

## Before you start

- **Rust 1.85 or newer.** Install it with [rustup](https://rustup.rs/).
- **A model that calls tools well.** The output on these pages comes from
  LM Studio serving `qwen/qwen3.8-27b` at `http://127.0.0.1:1234`, the
  address the program uses unless told otherwise. A hosted model works as
  well: an OpenAI-compatible API, or the Anthropic API.
- **A crate whose tests fail.** The practice crate below has six.

:::warning[It runs code a model wrote]
`ralph` runs `cargo test` on whatever the model wrote, and a test or a build
script can do anything you can. Run it on a copy of a crate, in a container
or a throwaway checkout, and read the diff before you keep it.
:::

## The practice crate

```bash
cargo new --lib wordfreq
```

Replace `wordfreq/src/lib.rs` with a function that does not do what its
documentation says, and the tests that say so:

```rust
use std::collections::HashMap;

/// The words of `text` and how often each occurs, the most frequent first.
///
/// Words are compared without regard to case, and the punctuation around a word
/// is not part of it. Words that occur equally often are in alphabetical order.
pub fn frequencies(text: &str) -> Vec<(String, usize)> {
    let mut counts = HashMap::new();
    for word in text.split(' ') {
        *counts.entry(word.to_string()).or_insert(0) += 1;
    }

    counts.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(pairs: &[(&str, usize)]) -> Vec<(String, usize)> {
        pairs.iter().map(|&(word, n)| (word.to_string(), n)).collect()
    }

    #[test]
    fn most_frequent_first() {
        assert_eq!(frequencies("a b a"), counts(&[("a", 2), ("b", 1)]));
    }

    #[test]
    fn case_does_not_matter() {
        assert_eq!(frequencies("River river RIVER"), counts(&[("river", 3)]));
    }

    #[test]
    fn punctuation_is_not_part_of_a_word() {
        let text = "Hello, world! Hello... (world) hello?";
        assert_eq!(frequencies(text), counts(&[("hello", 3), ("world", 2)]));
    }

    #[test]
    fn ties_in_alphabetical_order() {
        assert_eq!(frequencies("c a b"), counts(&[("a", 1), ("b", 1), ("c", 1)]));
    }

    #[test]
    fn any_whitespace_separates_words() {
        let text = "one\ttwo\n  two   ";
        assert_eq!(frequencies(text), counts(&[("two", 2), ("one", 1)]));
    }

    #[test]
    fn no_words() {
        assert_eq!(frequencies(" ... "), counts(&[]));
    }
}
```

Commit it, so that `git diff` shows what the model changes later:

```bash
cd wordfreq
git add -A && git commit -m "Failing tests"
cargo test
```

Six tests fail. Start with [Project and first call](./first-call).
