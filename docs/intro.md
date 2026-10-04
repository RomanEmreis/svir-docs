---
sidebar_position: 1
slug: /intro
title: Getting started
description: Install svir and talk to a model from Rust in a dozen lines.
---

# Getting started

svir is a small, composable Rust SDK for talking to large language models: the
wire protocol between your application and a model server, and nothing it does
not need.

It speaks **OpenAI-compatible Chat Completions, always streamed**, as served by
LM Studio, llama.cpp, vLLM, mlx-lm, Azure OpenAI, and hosted endpoints.

:::warning[Preview]
svir is in preview. The public API may still change between `0.x` releases.
What changed is in the
[changelog](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md). This
site describes **svir 0.1.4**.
:::

## Install

svir needs Rust **1.85** or newer (edition 2024). If you do not have Rust yet,
install it with [`rustup`](https://rustup.rs/).

```bash
cargo add svir
cargo add tokio --features macros,rt-multi-thread
```

Or by hand:

```toml title="Cargo.toml"
[dependencies]
svir = "0.1.4"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

The default features give you the client and HTTPS. The others are opt-in; see
[Features and TLS](./client/features).

## A first call

Start any OpenAI-compatible server. LM Studio listens on
`http://127.0.0.1:1234` by default; put the ID of a model it has in place of
`qwen3-27b`.

```rust title="src/main.rs"
use svir::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1234").build()?;
    let request = Request::new("qwen3-27b")
        .system("Be precise.")
        .user("Why do rivers meander?");

    // The whole answer.
    let answer = client.complete(&request).await?;
    println!("{}", answer.text.trim());

    // The same answer as it arrives.
    let mut stream = client.stream(&request).await?;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => print!("{piece}"),
            Event::Completed(done) => println!("\n{:?}", done.usage),
            _ => {}
        }
    }

    Ok(())
}
```

What this shows, and what every svir program repeats:

- `Client::openai(url)` returns a builder; `build()` checks the URL and the key
  and returns the client. The URL is the server's base, with or without `/v1`.
- The model is the ID the server lists, not a family name. To see what a server
  has, call [`client.list_models()`](./client/configuration#listing-models).
- The **client keeps no conversation**: the request is the conversation, and you
  own it.
- `complete` returns the finished answer. `stream` returns events as they
  arrive; the last one, `Event::Completed`, carries the whole answer.
- Dropping the stream cancels the request.

## What it covers

The core is the protocol:

- **Types**: messages with text, image, and file parts; tool descriptors,
  calls, and results; usage; finish reasons; one typed error.
- **Encoder**: the request body, streamed from disk with attachments, with an
  exact `Content-Length` known before the first byte.
- **Decoder**: SSE framing, tool calls assembled across deltas, reasoning from
  `reasoning_content`, `reasoning`, or inline `<think>` tags, usage, errors
  inside the stream, and hard limits. Strict by default, lenient on request.
- **Transport**: HTTP with optional Bearer authentication, typed status
  mapping, timeouts, and cancellation by drop.
- **Compatibility**: a server that rejects optional fields such as
  `reasoning_effort` is detected once and remembered.

On top of it, opt-in:

- **[Layers](./client/layers)**: middleware around every call, with `Retry`,
  `Timeout`, and `Trace` built in.
- **[Tools](./basics/tools)**: a `Toolbox` trait for anything that describes
  tools to a model and answers its calls, and `Tools`, a plain registry of
  typed handlers. No macros.

Not covered, on purpose: an agent loop, session history, storage, and MCP.
Those belong to the application. svir gives it the pieces, and the pages here
show the few lines each one takes.

## Principles

- **Protocol at the core, building blocks on top.** svir fits under a chat
  backend and under an agent engine without either bending around it.
- **Nothing is lost silently.** Tool-call IDs, reasoning, and provider
  continuation data survive a round trip. A feature an adapter cannot represent
  is an explicit error, not a dropped field.
- **Complete before executable.** A partially streamed tool call is display
  data only.
- **Strict and bounded by default.** Unknown input is an error unless you ask
  for leniency. Bytes, events, and tool calls always have limits, and reaching
  one is a typed outcome.
- **Credentials stay out of the record.** Keys never reach errors, events, or
  logs.
- **Testable without a model.** The transport sits behind one trait, so code
  that calls a model can be tested with no server at all.

## Where to next

- [Requests](./basics/requests) and [Reading an answer](./basics/answers) cover
  the everyday calls.
- [Tools](./basics/tools) shows the loop that feeds tool results back.
- [Configuration](./client/configuration) and [Layers](./client/layers) cover
  the client.
- [Errors](./errors) and [Troubleshooting](./troubleshooting) are for when it
  does not work.
- The [Agent Skill](./agent-skill) teaches a coding assistant all of the above.

The [examples directory](https://github.com/RomanEmreis/svir/tree/main/examples)
has one short program per way of using svir, and the
[API reference](https://docs.rs/svir/latest/svir/) is on docs.rs.
