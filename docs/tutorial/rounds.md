---
sidebar_position: 4
title: Rounds
description: A fresh conversation each round, notes that carry the work from one to the next, and the program, not the model, deciding when it is done.
---

# Rounds

In this chapter the program runs the tool loop again and again, each time
with a fresh conversation, until the tests pass. What one round learned
reaches the next through a file.

## Why start over

A conversation only grows. Every answer is paid for with the whole
conversation before it, files read and test output included, and a model
deep in a long context loses track of what it was doing. A job too big for
one conversation needs a way to put it down and pick it up again.

So a round that ends with the tests still failing is not continued. The next
one starts from what a person would hand over: the task, the model's own
notes, and what `cargo test` prints now.

## Notes that carry over

The system prompt asks for the notes:

```rust skip
/// What the model is asked to do, in every round.
const SYSTEM: &str = "You fix a Rust crate so that `cargo test` passes. \
    Read the files you need, change the code with write_file, and check it with run_tests. \
    Do not change the tests. Keep NOTES.md up to date as you go: what you changed, what you \
    learned, and what is left. A round can end at any time, and the next one starts from \
    those notes and nothing else.";

/// The file the model keeps its notes in, from one round to the next.
const NOTES: &str = "NOTES.md";

/// Rounds before the program gives up.
const ROUNDS: usize = 5;
```

The model writes them with the `write_file` it already has, and as it goes,
not at the end: a round can end without warning, when `TURNS` runs out or a
call is cut short, and notes saved for the end would be lost with it. The
program reads them at the start of each round:

```rust skip
/// The notes the model left, or a word that there are none.
async fn notes(&self) -> String {
    tokio::fs::read_to_string(self.root.join(NOTES))
        .await
        .unwrap_or_else(|_| "None: this is the first round.".to_owned())
}
```

The state is in the crate, not in the program: the code the model changed and
the notes it left. Stop the program, and the next run starts where this one
stopped.

## The program decides

`run` becomes the outer loop:

```rust skip
let mut rounds = 0;
loop {
    let tests = workspace.test().await?;
    if tests.passed {
        println!("\n== the tests pass after {rounds} round(s)");
        return Ok(());
    }
    if rounds == ROUNDS {
        return Err(format!("the tests still fail after {ROUNDS} rounds").into());
    }

    rounds += 1;
    println!("\n== round {rounds}");
    let notes = workspace.notes().await;
    let request = Request::new(&model)
        .system(SYSTEM)
        .max_tokens(MAX_TOKENS)
        .reasoning(Effort::Medium)
        .tools(&tools)
        .user(format!(
            "Your notes:\n\n{notes}\n\n`cargo test` prints:\n\n{}",
            tests.output
        ));
    round(&client, &tools, request).await?;
}
```

- **The tests are the judge.** A model that says "all tests pass" may be
  wrong, so the program runs them itself, before every round and after the
  last.
- **A new `Request` each round.** Nothing of the last conversation is in it,
  only the notes. The client keeps nothing between calls either: there is no
  session to reset.
- **However a round ends, the check comes next.** The model stopped, a call
  was cut short, or `TURNS` ran out: `round` returns, and the loop looks at
  the tests.
- **`ROUNDS` rounds at most.** A model that cannot fix the crate is stopped,
  and the program fails with a message.

Both loops are yours. svir sends a request and streams back the answer; how
many times, with what, and when to stop is this function.

## Run it

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
== round 1

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;
The issues are clear from the source and failures: single-space split, no punctuation stripping, no lowercasing, and no sorting. Let me fix it.


-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th
<- wrote src/lib.rs

-> write_file {"content":"# NOTES\n\n## Task\nMake `cargo test` pass for the word-freq
-> run_tests {}
<- wrote NOTES.md
<- PASSED
All 6 tests pass. Let me finalize the notes.


-> write_file {"content":"# NOTES\n\n## Task\nMake `cargo test` pass for the word-freq
<- wrote NOTES.md
The work is complete, but let me do a final verification of the current state.


-> read_file {"path":"src/lib.rs"}

-> run_tests {}
<- use std::collections::HashMap;
<- PASSED
All 6 tests pass and the source matches the fixed implementation. NOTES.md is current. Nothing is left to do — `cargo test` is green.

Summary of what was fixed in `src/lib.rs`:
- Split on any whitespace via `split_whitespace()`.
- Strip surrounding non-alphanumeric punctuation from each token.
- Lowercase words for case-insensitive counting.
- Drop tokens that become empty after trimming.
- Sort by count descending, then alphabetically for ties.

== the tests pass after 1 round(s)
```

This model fixed the crate in one round, with notes written next to the fix,
and checked its work twice before it stopped.

## A round cut short

To see a round end before the model does, set `TURNS` to 3 and run it on a
fresh copy of `wordfreq`:

```text
== round 1

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;
The current implementation only splits on a single space, doesn't lowercase, doesn't strip punctuation, and doesn't sort. Let me fix it.


-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th

-> write_file {"path":"NOTES.md","content":"# Notes\n\n## What the crate does\n`freque
<- wrote src/lib.rs
<- wrote NOTES.md

-> run_tests {}
<- PASSED
-- 3 answers in this round; the round ends

== the tests pass after 1 round(s)
```

The round ran out of answers right after `run_tests`, before the model could
say it was done. The program's own check found the tests passing, so there was
no second round. Had they failed, it would have started from the notes the
model wrote together with the fix:

```markdown title="NOTES.md"
# Notes

## What the crate does
`frequencies(text)` returns (word, count) pairs: most frequent first, ties in
alphabetical order, case-insensitive, punctuation stripped.

## What was wrong (initial state)
- Split only on a single space `' '` → `\t`, `\n` stayed attached.
- Kept original case (`River`/`river` counted separately).
- Kept punctuation (`hello?`, `(world)`, `...`).
- No sorting; relied on HashMap iteration order.
- Empty/whitespace tokens were counted as words.

## What I changed (this round)
- `src/lib.rs`: split with `split_whitespace()`, lowercase, keep only
  alphanumeric chars, skip empty tokens, then sort by count desc, word asc.
- Tests left untouched.

## What I learned
- Expected words are fully lowercase, so lowercasing before counting is what
  the tests want (e.g. `("river", 3)`).

## What is left
- Verify with `cargo test` (not yet run this round).
```

<details>
<summary>The whole <code>src/main.rs</code></summary>

```rust
use std::{
    io::Write,
    path::{Component, Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::Arc,
    time::Duration,
};

use schemars::JsonSchema;
use serde::Deserialize;
use svir::prelude::*;
use tokio::process::Command;

/// What the model is asked to do, in every round.
const SYSTEM: &str = "You fix a Rust crate so that `cargo test` passes. \
    Read the files you need, change the code with write_file, and check it with run_tests. \
    Do not change the tests. Keep NOTES.md up to date as you go: what you changed, what you \
    learned, and what is left. A round can end at any time, and the next one starts from \
    those notes and nothing else.";

/// The file the model keeps its notes in, from one round to the next.
const NOTES: &str = "NOTES.md";

/// Rounds before the program gives up.
const ROUNDS: usize = 5;

/// Answers in one round before the round ends.
const TURNS: usize = 20;

/// Tokens one answer may take.
const MAX_TOKENS: u64 = 16_000;

/// How much of the test output the model sees, from the end.
const OUTPUT_CHARS: usize = 6_000;

/// How much of a call's arguments, or of its result, is shown.
const SHOWN_CHARS: usize = 72;

/// How long `cargo test` may run.
const TEST_TIME: Duration = Duration::from_secs(300);

/// What went wrong, for the person who runs the program.
type Failure = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("ralph: {failure}");
            let error = failure.downcast_ref::<Error>();
            if let Some(message) = error.and_then(Error::server_message) {
                eprintln!("the server says: {message}");
            }
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Failure> {
    let model = std::env::var("RALPH_MODEL").map_err(|_| "set RALPH_MODEL to a model")?;
    let root = std::env::args().nth(1).ok_or("usage: ralph <crate>")?;
    let workspace = Workspace::new(root);
    let client = client()?;
    let tools = workspace.tools();

    let mut rounds = 0;
    loop {
        let tests = workspace.test().await?;
        if tests.passed {
            println!("\n== the tests pass after {rounds} round(s)");
            return Ok(());
        }
        if rounds == ROUNDS {
            return Err(format!("the tests still fail after {ROUNDS} rounds").into());
        }

        rounds += 1;
        println!("\n== round {rounds}");
        let notes = workspace.notes().await;
        let request = Request::new(&model)
            .system(SYSTEM)
            .max_tokens(MAX_TOKENS)
            .reasoning(Effort::Medium)
            .tools(&tools)
            .user(format!(
                "Your notes:\n\n{notes}\n\n`cargo test` prints:\n\n{}",
                tests.output
            ));
        round(&client, &tools, request).await?;
    }
}

/// A client for the server `RALPH_API` names.
fn client() -> Result<Client, Failure> {
    let (mut builder, key) = match std::env::var("RALPH_API").as_deref() {
        Ok("anthropic") => (Client::anthropic(), "ANTHROPIC_API_KEY"),
        Ok("openai") | Err(_) => (Client::openai("http://127.0.0.1:1234"), "OPENAI_API_KEY"),
        Ok(other) => return Err(format!("RALPH_API is openai or anthropic, not {other}").into()),
    };
    if let Ok(url) = std::env::var("RALPH_URL") {
        builder = builder.base_url(url);
    }
    if std::env::var_os(key).is_some() {
        builder = builder.api_key_env(key);
    }

    Ok(builder.build()?)
}

/// One round: a fresh conversation that goes on while the model calls tools.
async fn round(client: &Client, tools: &Tools, mut request: Request) -> Result<(), Error> {
    for _ in 0..TURNS {
        let done = show(client.stream(&request).await?).await?;
        if !done.cut_calls.is_empty() {
            println!("-- the output limit cut a call short; the round ends");
            return Ok(());
        }
        if done.calls.is_empty() {
            return Ok(());
        }

        let results = tools.call_all(&done.calls).await;
        for result in &results {
            let first = result.content.lines().next().unwrap_or_default();
            println!("<- {}", clip(first, SHOWN_CHARS));
        }
        request = request.assistant(done).tool_results(results);
    }

    println!("-- {TURNS} answers in this round; the round ends");
    Ok(())
}

/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    let mut shown = 0;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
            }
            // A call streams too, though it runs only once it is complete. Only its start is
            // shown: a file the model writes can be long.
            Event::ToolCallDelta(piece) => {
                if let Some(name) = piece.name {
                    print!("\n-> {name} ");
                    shown = 0;
                }
                let room = SHOWN_CHARS.saturating_sub(shown);
                print!("{}", clip(&piece.arguments, room));
                shown += piece.arguments.chars().count();
            }
            Event::Completed(done) => {
                println!();
                return Ok(done);
            }
            _ => {}
        }
        std::io::stdout().flush().ok();
    }

    Err(Error::new(ErrorKind::TruncatedStream))
}

/// The crate the model works on. Every path it names stays inside.
#[derive(Clone)]
struct Workspace {
    root: Arc<Path>,
}

/// What `cargo test` said.
struct Tests {
    passed: bool,
    output: String,
}

/// The arguments of a tool that takes none.
#[derive(Deserialize)]
struct Nothing {}

#[derive(Deserialize, JsonSchema)]
struct ReadFile {
    /// The file's path from the crate's root, such as `src/lib.rs`.
    path: String,
}

#[derive(Deserialize, JsonSchema)]
struct WriteFile {
    /// The file's path from the crate's root.
    path: String,
    /// The whole new content of the file.
    content: String,
}

impl Workspace {
    fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Arc::from(root.into()),
        }
    }

    /// The tools the model works with, each answering on a clone of the workspace.
    fn tools(&self) -> Tools {
        let (list, read, write, test) = (self.clone(), self.clone(), self.clone(), self.clone());
        // A tool that takes no arguments keeps the empty schema `Tool::new` gives it.
        let list_files = Tool::new("list_files", "List the files of the crate.");
        let run_tests = Tool::new("run_tests", "Run `cargo test` and read what it printed.");

        Tools::new()
            .add_tool(list_files, move |_: Nothing| list.clone().list_files())
            .add("read_file", "Read a file of the crate.", move |args| {
                read.clone().read_file(args)
            })
            .add("write_file", "Write a file of the crate.", move |args| {
                write.clone().write_file(args)
            })
            .add_tool(run_tests, move |_: Nothing| test.clone().run_tests())
    }

    /// A path the model named, if it stays inside the workspace.
    fn path(&self, relative: &str) -> std::io::Result<PathBuf> {
        let inside = Path::new(relative)
            .components()
            .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
        if !inside {
            let error = format!("{relative} is outside the crate");
            return Err(std::io::Error::other(error));
        }

        Ok(self.root.join(relative))
    }

    async fn list_files(self) -> std::io::Result<String> {
        let mut files = Vec::new();
        let mut dirs = vec![PathBuf::new()];
        while let Some(dir) = dirs.pop() {
            let mut entries = tokio::fs::read_dir(self.root.join(&dir)).await?;
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name();
                if name == "target" || name.to_string_lossy().starts_with('.') {
                    continue;
                }

                let path = dir.join(name);
                if entry.file_type().await?.is_dir() {
                    dirs.push(path);
                } else {
                    files.push(path.display().to_string());
                }
            }
        }

        files.sort();
        Ok(files.join("\n"))
    }

    async fn read_file(self, args: ReadFile) -> std::io::Result<String> {
        tokio::fs::read_to_string(self.path(&args.path)?).await
    }

    async fn write_file(self, args: WriteFile) -> std::io::Result<String> {
        let path = self.path(&args.path)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, &args.content).await?;

        Ok(format!("wrote {}", args.path))
    }

    async fn run_tests(self) -> std::io::Result<String> {
        let tests = self.test().await?;
        let verdict = if tests.passed { "PASSED" } else { "FAILED" };

        Ok(format!("{verdict}\n{}", tests.output))
    }

    /// Runs `cargo test` in the crate.
    async fn test(&self) -> std::io::Result<Tests> {
        let run = Command::new("cargo")
            .args(["test", "--quiet", "--color", "never"])
            .current_dir(&self.root)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output();
        let output = tokio::time::timeout(TEST_TIME, run).await??;

        let mut printed = String::from_utf8_lossy(&output.stdout).into_owned();
        printed.push_str(&String::from_utf8_lossy(&output.stderr));
        Ok(Tests {
            passed: output.status.success(),
            output: tail(&printed, OUTPUT_CHARS).to_owned(),
        })
    }

    /// The notes the model left, or a word that there are none.
    async fn notes(&self) -> String {
        tokio::fs::read_to_string(self.root.join(NOTES))
            .await
            .unwrap_or_else(|_| "None: this is the first round.".to_owned())
    }
}

/// The first `chars` characters of `text`.
fn clip(text: &str, chars: usize) -> &str {
    match text.char_indices().nth(chars) {
        Some((at, _)) => &text[..at],
        None => text,
    }
}

/// The last `chars` characters of `text`.
fn tail(text: &str, chars: usize) -> &str {
    let skip = text.chars().count().saturating_sub(chars);
    match text.char_indices().nth(skip) {
        Some((at, _)) => &text[at..],
        None => "",
    }
}
```

</details>

Next, [Layers and a budget](./layers): what a run may cost.
