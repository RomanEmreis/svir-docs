---
sidebar_position: 4
title: Conversations
description: The request is the conversation. Keeping history, sending reasoning back, storing and restoring.
---

# Conversations

The client keeps nothing between calls. **The request is the conversation**,
and the caller owns it: each turn adds the user's message, sends the request,
and puts the model's answer back into it.

```rust
use svir::prelude::*;

async fn converse(client: &Client, lines: Vec<String>) -> Result<(), Error> {
    let mut request = Request::new("qwen3-27b").system("You are a concise assistant.");

    for line in lines {
        request = request.user(line);

        let done = client.complete(&request).await?;
        println!("{}", done.text.trim());

        // The answer goes back as it is: text, tool calls, reasoning.
        request = request.assistant(done);
    }

    Ok(())
}
```

## Put the completion itself back

`request.assistant(done)` takes the `Completion` by value and turns it into an
assistant message with its reasoning, text, and tool calls. Clone it first if
you also store it elsewhere. `Message::from(done)` does the same for code that
builds messages by hand.

Rebuilding the assistant turn from `done.text` with `Message::assistant(..)`
loses the tool calls and their IDs. That is fine for a stored conversation that
had no tools, and wrong for a live one.

## History is yours

- The history grows with every turn. Trimming or summarizing it is the
  application's policy; a request that no longer fits fails with
  `ErrorKind::ContextOverflow`.
- When a call fails, the user message already added is still in the request.
  Decide whether to keep it for the retry or rebuild the request.
- Build one `Client` per server and clone it freely. Many conversations can
  share it: it holds connections, not chats.

## Sending reasoning back

Reasoning in earlier answers is kept in the history but not sent back unless the
request says `.send_reasoning(true)`. When it is sent, it goes under the field
it arrived in (`reasoning_content` or `reasoning`), since a server expects its
own field back unchanged. The same text in both fields is one piece and goes
back as `reasoning_content`. Reasoning split out of inline `<think>` tags is
never sent back.

```rust
use svir::prelude::*;

fn with_reasoning(request: Request) -> Request {
    // For servers that want the model's earlier reasoning in the history.
    request.send_reasoning(true)
}
```

## Storing and restoring

`Request`, `Message`, `Part`, `Completion`, and the rest of the public data
types implement `Serialize` and `Deserialize`. Their serde form is part of the
public API, pinned by the crate's tests, so a stored conversation is a format
you can rely on rather than an accident of the struct layout.

```rust
use svir::prelude::*;

fn roundtrip(request: &Request) -> Result<Request, serde_json::Error> {
    let stored = serde_json::to_string(request)?;

    serde_json::from_str(&stored)
}
```

An attachment given as a path is stored as the path, and one given as bytes is
stored as base64. A stored path has to exist again when the request is sent.

To rebuild a conversation from your own storage instead, use the
constructors: `Message::user(..)`, `Message::assistant(..)`, and
`Message::tool_result(..)`. Public data types are `#[non_exhaustive]`, so they
cannot be built with struct literals.
