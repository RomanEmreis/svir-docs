---
sidebar_position: 2
title: Project and first call
description: A client for an OpenAI-compatible server or the Anthropic Messages API, chosen when the program starts, and a streamed answer about failing tests.
---

# Project and first call

In this chapter the program gets a client, runs the tests, and asks the model
why they fail. The answer streams to the terminal as the model writes it.

## Create the project

Next to the `wordfreq` directory:

```bash
cargo new ralph
cd ralph
```

Add the dependencies to `Cargo.toml`:

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.2", features = ["schemars", "tls-ring"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "fs", "process", "time"] }
serde = { version = "1", features = ["derive"] }
schemars = "1"
```

- **`svir`** with `schemars` derives a tool's schema from a Rust type, which
  the next chapter uses, and with `tls-ring` speaks HTTPS to a hosted server.
  A server on your own machine needs no TLS; see
  [Features and TLS](../client/features).
- **`tokio`** is the runtime svir runs on. `fs`, `process`, and `time` are for
  the files, `cargo test`, and its deadline.
- **`serde`** reads a tool's arguments into a type, and **`schemars`** writes
  the schema of that type for the model. The next chapter uses both.

## Choose the server when the program starts

`Client::openai` and `Client::anthropic` both return a `ClientBuilder`, and
both build the same `Client`. Which one the program uses is decided by an
environment variable, and nothing after `client()` knows the difference:

```rust skip
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
```

| Variable | What it says | Unless set |
|---|---|---|
| `RALPH_API` | `openai` for an OpenAI-compatible server, `anthropic` for the Messages API | `openai` |
| `RALPH_URL` | Where the server is | `http://127.0.0.1:1234`, or the Anthropic API |
| `RALPH_MODEL` | The model | Required |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | The key for the API in use | No key: a local server needs none |

svir reads no environment variable on its own: the program reads them and
tells the builder. `api_key_env` reads the key when `build()` runs, and keeps
it out of every error and log line. `Failure` is the program's error type, a
[boxed error](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html#where-the--operator-can-be-used)
that `?` turns any error into.

## Run the tests

The workspace is the crate the model works on. Its `test` runs `cargo test`
there:

```rust skip
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
```

- **One fixed command, no shell.** The arguments are a list, so nothing in
  them is interpreted, and the model will never choose them.
- **A deadline.** A test that never ends is stopped after `TEST_TIME`:
  `timeout` drops the run, and `kill_on_drop` kills `cargo` with it.
- **The end of the output.** Cargo says what failed last, so the model gets
  the last `OUTPUT_CHARS` characters, enough for six failures and few enough
  to keep the prompt small.

The workspace keeps its root in an `Arc<Path>`, so that a clone of it is
cheap: the tools in the next chapter each hold one.

## Ask the model

```rust skip
async fn run() -> Result<(), Failure> {
    let model = std::env::var("RALPH_MODEL").map_err(|_| "set RALPH_MODEL to a model")?;
    let root = std::env::args().nth(1).ok_or("usage: ralph <crate>")?;
    let workspace = Workspace::new(root);
    let client = client()?;

    let tests = workspace.test().await?;
    if tests.passed {
        println!("the tests pass");
        return Ok(());
    }

    let question = format!("Why do these tests fail? Be brief.\n\n{}", tests.output);
    let request = Request::new(&model).max_tokens(MAX_TOKENS).user(question);
    show(client.stream(&request).await?).await?;

    Ok(())
}
```

The request is the whole conversation: here, one user message. `max_tokens`
caps the answer. The Messages API refuses a request without it, so the
program always sets it, whichever API it talks to.

`client.stream` returns once the server starts to answer, with a stream of
events. `show` prints the text as it arrives and returns the whole answer,
which is always the last event:

```rust skip
/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
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
```

The `_` arm skips what this chapter does not show: the model's reasoning, and
the pieces of tool calls. A stream that ends without `Completed` has already
yielded an error, so the last line is never reached; the compiler still wants
a value there. See [Reading an answer](../basics/answers) for every event.

When something fails, `main` prints the error, and the server's own words
when it sent some:

```rust skip
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
```

## Run it

With LM Studio serving `qwen/qwen3.8-27b`:

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
They fail because the implementation isn’t normalizing/filtering tokens correctly:

- Punctuation is kept as part of words (`"(world)"`, `"Hello,"`, etc.).
- Words aren’t lowercased, so `river`, `River`, and `RIVER` don’t merge.
- It doesn’t split on all whitespace, so tabs/newlines remain or empty tokens appear.
- Non-word tokens like `""` and `"..."` aren’t filtered out.
- Results aren’t sorted alphabetically for ties.
```

The same program, against the Anthropic API:

```bash
RALPH_API=anthropic ANTHROPIC_API_KEY=sk-ant-... RALPH_MODEL=claude-opus-5-5 cargo run -- ../wordfreq
```

<details>
<summary>The whole <code>src/main.rs</code></summary>

```rust
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::Arc,
    time::Duration,
};

use svir::prelude::*;
use tokio::process::Command;

/// Tokens one answer may take.
const MAX_TOKENS: u64 = 16_000;

/// How much of the test output the model sees, from the end.
const OUTPUT_CHARS: usize = 6_000;

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

    let tests = workspace.test().await?;
    if tests.passed {
        println!("the tests pass");
        return Ok(());
    }

    let question = format!("Why do these tests fail? Be brief.\n\n{}", tests.output);
    let request = Request::new(&model).max_tokens(MAX_TOKENS).user(question);
    show(client.stream(&request).await?).await?;

    Ok(())
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

/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
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

/// The crate the model works on.
#[derive(Clone)]
struct Workspace {
    root: Arc<Path>,
}

/// What `cargo test` said.
struct Tests {
    passed: bool,
    output: String,
}

impl Workspace {
    fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Arc::from(root.into()),
        }
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

Next, [Tools](./tools): the model reads and changes the crate itself.
